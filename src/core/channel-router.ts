/**
 * Channel Router
 * Bridges channel messages to ChatSessions and routes responses back.
 * Handles audio transcription, per-chat session management, and error delivery.
 */

import type { AgenticLoop } from './loop';
import type { ChannelManager } from './channel-manager';
import type { EventBus } from './event-bus';
import type { EnhancedChannel, RichChannelMessage } from './channel-types';
import type { TranscriptionProvider } from './transcription';
import type { Logger } from '../infra/logger';
import type { Config } from './types';
import type { Database } from '../infra/database';
import type { LLMProvider } from './plugin-api-types';
import { ChatSession } from './chat-session';
import { BackgroundTaskRunner } from './background-task-runner';
import { LegacyChannelHandler } from './legacy-channel-handler';

// ---------------------------------------------------------------------------
// Channel Router Options
// ---------------------------------------------------------------------------

export interface ChannelRouterOptions {
  /** @deprecated Kept for backward compatibility. When db/provider/config are provided, ChatSession is used instead. */
  loop?: AgenticLoop;
  channelManager: ChannelManager;
  eventBus: EventBus;
  transcriptionProvider?: TranscriptionProvider;
  logger: Logger;
  db?: Database;
  provider?: LLMProvider;
  config?: Config;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const SESSION_IDLE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Channel Router
// ---------------------------------------------------------------------------

export class ChannelRouter {
  private loop: AgenticLoop | null;
  private channelManager: ChannelManager;
  private eventBus: EventBus;
  private transcription: TranscriptionProvider | null;
  private logger: Logger;
  private chatSessions: Map<string, ChatSession> = new Map();
  private chatSessionLastActive: Map<string, number> = new Map();
  private taskRunner: BackgroundTaskRunner | null = null;
  private unsubscribers: Array<() => void> = [];
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null;

  // Dependencies for ChatSession creation (dialog mode)
  private db: Database | null;
  private provider: LLMProvider | null;
  private config: Config | null;

  // Legacy handler for backward compat (loop-based mode)
  private legacyHandler: LegacyChannelHandler | null = null;

  constructor(options: ChannelRouterOptions) {
    this.loop = options.loop ?? null;
    this.channelManager = options.channelManager;
    this.eventBus = options.eventBus;
    this.transcription = options.transcriptionProvider ?? null;
    this.logger = options.logger;
    this.db = options.db ?? null;
    this.provider = options.provider ?? null;
    this.config = options.config ?? null;

    if (this.isDialogMode()) {
      this.taskRunner = new BackgroundTaskRunner({
        db: this.db!, eventBus: this.eventBus, config: this.config!, provider: this.provider!,
      });
    } else if (this.loop) {
      this.legacyHandler = new LegacyChannelHandler({
        loop: this.loop,
        eventBus: this.eventBus,
        logger: this.logger,
        resolveChatId: (msg) => this.resolveChatId(msg),
      });
    }
  }

  /** Wire all registered channels' message events to the router */
  start(): void {
    for (const channel of this.channelManager.list()) {
      const unsub = channel.on('message', async (message: RichChannelMessage) => {
        await this.handleMessage(message, channel);
      });
      this.unsubscribers.push(unsub);

      const errorUnsub = channel.on('error', (err: Error) => {
        this.logger.error(`Channel ${channel.id} error`, { error: err.message });
      });
      this.unsubscribers.push(errorUnsub);
    }
    if (this.isDialogMode()) {
      this.idleCheckTimer = setInterval(() => this.evictIdleSessions(), SESSION_IDLE_CHECK_INTERVAL_MS);
    }

    this.logger.info('ChannelRouter started', {
      channelCount: String(this.channelManager.list().length),
    });
  }

  /** Stop processing, flush queue, disconnect channels */
  async stop(): Promise<void> {
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
      this.idleCheckTimer = null;
    }
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    if (this.legacyHandler) this.legacyHandler.stop();

    for (const session of this.chatSessions.values()) session.stop();
    this.chatSessions.clear();
    this.chatSessionLastActive.clear();

    if (this.taskRunner) this.taskRunner.stopAll();

    await this.channelManager.disconnectAll();
    this.logger.info('ChannelRouter stopped');
  }

  // -----------------------------------------------------------------------
  // Message Handling
  // -----------------------------------------------------------------------

  private async handleMessage(message: RichChannelMessage, channel: EnhancedChannel): Promise<void> {
    try {
      await this.eventBus.emit('message:received', {
        message: {
          uuid: message.id, parentUuid: null, role: 'user' as const,
          content: message.content, createdAt: message.timestamp,
        },
        channelId: channel.id,
      });

      let text = message.content;
      if (this.isAudioMessage(message) && message.attachments.length > 0) {
        const transcribed = await this.transcribeAudio(message, channel);
        if (transcribed) {
          text = transcribed;
        } else if (!text) {
          const chatId = this.resolveChatId(message);
          await channel.sendText(chatId, 'Sorry, I could not transcribe that audio message.');
          return;
        }
      }

      const trimmed = text?.trim();
      if (!trimmed) return;

      if (this.isDialogMode()) {
        await this.routeToSession(trimmed, message, channel);
      } else if (this.legacyHandler) {
        this.legacyHandler.enqueue({ message, channel, text: trimmed });
      }
    } catch (err) {
      this.logger.error('Failed to handle channel message', {
        channelId: channel.id, messageId: message.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private static AUDIO_TYPES: ReadonlySet<string> = new Set(['voice', 'audio', 'video_note']);

  private isAudioMessage(message: RichChannelMessage): boolean {
    return ChannelRouter.AUDIO_TYPES.has(message.messageType);
  }

  private resolveChatId(message: RichChannelMessage): string {
    const meta = message.metadata as Record<string, unknown>;
    return String(meta['chatId'] ?? meta['telegramChatId'] ?? message.channelId ?? message.senderId);
  }

  // -----------------------------------------------------------------------
  // Dialog Mode (ChatSession-based)
  // -----------------------------------------------------------------------

  private isDialogMode(): boolean {
    return this.db !== null && this.provider !== null && this.config !== null;
  }

  private async routeToSession(
    text: string, message: RichChannelMessage, channel: EnhancedChannel,
  ): Promise<void> {
    const chatId = this.resolveChatId(message);
    const sessionKey = `${channel.id}:${chatId}`;

    let session = this.chatSessions.get(sessionKey);
    if (!session) {
      session = new ChatSession({
        chatKey: sessionKey, chatId, channel,
        db: this.db!, eventBus: this.eventBus, config: this.config!,
        provider: this.provider!, taskRunner: this.taskRunner!,
      });
      this.chatSessions.set(sessionKey, session);
    }
    this.chatSessionLastActive.set(sessionKey, Date.now());

    await session.handleMessage(text, message);
  }

  private evictIdleSessions(): void {
    const now = Date.now();
    for (const [key, lastActive] of this.chatSessionLastActive) {
      if (now - lastActive < SESSION_IDLE_TIMEOUT_MS) continue;
      const session = this.chatSessions.get(key);
      if (session) {
        session.stop();
        this.chatSessions.delete(key);
      }
      this.chatSessionLastActive.delete(key);
      this.logger.info('Evicted idle chat session', { sessionKey: key });
    }
  }

  // -----------------------------------------------------------------------
  // Audio Transcription
  // -----------------------------------------------------------------------

  private async transcribeAudio(
    message: RichChannelMessage, channel: EnhancedChannel,
  ): Promise<string | null> {
    if (!this.transcription) {
      this.logger.warn('No transcription provider configured, skipping audio');
      return null;
    }

    const attachment = message.attachments[0];
    if (!attachment?.url) return null;

    try {
      const file = await channel.downloadAttachment(attachment.url);
      const result = await this.transcription.transcribe(file.data, file.fileName ?? 'audio.ogg');
      const prefix = message.content ? `${message.content}\n\n` : '';
      return `${prefix}[Voice message transcription]: ${result.text}`;
    } catch (err) {
      this.logger.error('Audio transcription failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let globalRouter: ChannelRouter | null = null;

export function createChannelRouter(options: ChannelRouterOptions): ChannelRouter {
  globalRouter = new ChannelRouter(options);
  return globalRouter;
}

export function getChannelRouter(): ChannelRouter | null {
  return globalRouter;
}
