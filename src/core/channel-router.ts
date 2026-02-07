/**
 * Channel Router
 * Bridges channel messages to the AgenticLoop and routes responses back.
 * Handles audio transcription, message serialization, and error delivery.
 */

import type { AgenticLoop } from './loop';
import type { ChannelManager } from './channel-manager';
import type { EventBus } from './event-bus';
import type { EnhancedChannel, RichChannelMessage } from './channel-types';
import type { TranscriptionProvider } from './transcription';
import type { Logger } from '../infra/logger';

// ---------------------------------------------------------------------------
// Queue Item
// ---------------------------------------------------------------------------

interface QueueItem {
  message: RichChannelMessage;
  channel: EnhancedChannel;
  text: string;
}

// ---------------------------------------------------------------------------
// Channel Router Options
// ---------------------------------------------------------------------------

export interface ChannelRouterOptions {
  loop: AgenticLoop;
  channelManager: ChannelManager;
  eventBus: EventBus;
  transcriptionProvider?: TranscriptionProvider;
  logger: Logger;
}

// ---------------------------------------------------------------------------
// Channel Router
// ---------------------------------------------------------------------------

export class ChannelRouter {
  private loop: AgenticLoop;
  private channelManager: ChannelManager;
  private eventBus: EventBus;
  private transcription: TranscriptionProvider | null;
  private logger: Logger;
  private queue: QueueItem[] = [];
  private processing = false;
  private sessions: Map<string, string> = new Map();
  private unsubscribers: Array<() => void> = [];
  private stopped = false;

  constructor(options: ChannelRouterOptions) {
    this.loop = options.loop;
    this.channelManager = options.channelManager;
    this.eventBus = options.eventBus;
    this.transcription = options.transcriptionProvider ?? null;
    this.logger = options.logger;
  }

  /** Wire all registered channels' message events to the router */
  start(): void {
    this.stopped = false;
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
    this.logger.info('ChannelRouter started', {
      channelCount: String(this.channelManager.list().length),
    });
  }

  /** Stop processing, flush queue, disconnect channels */
  async stop(): Promise<void> {
    this.stopped = true;
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
    this.queue = [];
    await this.channelManager.disconnectAll();
    this.logger.info('ChannelRouter stopped');
  }

  // -----------------------------------------------------------------------
  // Message Handling
  // -----------------------------------------------------------------------

  private async handleMessage(
    message: RichChannelMessage,
    channel: EnhancedChannel,
  ): Promise<void> {
    try {
      await this.eventBus.emit('message:received', {
        message: {
          uuid: message.id,
          parentUuid: null,
          role: 'user' as const,
          content: message.content,
          createdAt: message.timestamp,
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

      this.enqueue({ message, channel, text: trimmed });
    } catch (err) {
      this.logger.error('Failed to handle channel message', {
        channelId: channel.id,
        messageId: message.id,
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
    return String(
      meta['chatId'] ?? meta['telegramChatId'] ?? message.channelId ?? message.senderId,
    );
  }

  // -----------------------------------------------------------------------
  // Audio Transcription
  // -----------------------------------------------------------------------

  private async transcribeAudio(
    message: RichChannelMessage,
    channel: EnhancedChannel,
  ): Promise<string | null> {
    if (!this.transcription) {
      this.logger.warn('No transcription provider configured, skipping audio');
      return null;
    }

    const attachment = message.attachments[0];
    if (!attachment?.url) return null;

    try {
      const file = await channel.downloadAttachment(attachment.url);
      const result = await this.transcription.transcribe(
        file.data,
        file.fileName ?? 'audio.ogg',
      );

      const prefix = message.content ? `${message.content}\n\n` : '';
      return `${prefix}[Voice message transcription]: ${result.text}`;
    } catch (err) {
      this.logger.error('Audio transcription failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Serialization Queue
  // -----------------------------------------------------------------------

  private enqueue(item: QueueItem): void {
    this.queue.push(item);
    if (!this.processing) {
      void this.processNext();
    }
  }

  private async processNext(): Promise<void> {
    if (this.stopped || this.queue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const item = this.queue.shift()!;

    try {
      await this.processMessage(item);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error('Failed to process queued message', { error: errorMsg });
      try {
        const chatId = this.resolveChatId(item.message);
        const userMessage = this.classifyProcessingError(errorMsg);
        await item.channel.sendText(chatId, userMessage);
      } catch {
        // Swallow send errors during error handling
      }
    }

    if (!this.stopped) {
      void this.processNext();
    }
  }

  private classifyProcessingError(errorMsg: string): string {
    const lower = errorMsg.toLowerCase();
    if (lower.includes('only authorized for use with claude code') || lower.includes('credential')) {
      return 'Bot API credentials are not configured correctly. Please set a valid Anthropic API key in ~/.daemux/settings.json (anthropicApiKey field).';
    }
    if (lower.includes('authentication') || lower.includes('401') || lower.includes('invalid api key')) {
      return 'Bot authentication failed. Please check your API key configuration.';
    }
    if (lower.includes('rate limit') || lower.includes('429')) {
      return 'The service is temporarily rate-limited. Please try again in a moment.';
    }
    if (lower.includes('overloaded') || lower.includes('529')) {
      return 'The AI service is currently overloaded. Please try again shortly.';
    }
    return 'An error occurred while processing your message.';
  }

  private async processMessage(item: QueueItem): Promise<void> {
    const { message, channel, text } = item;
    const chatId = this.resolveChatId(message);
    const sessionKey = `${channel.id}:${chatId}`;
    const existingSessionId = this.sessions.get(sessionKey);

    const result = await this.loop.run(text, {
      sessionId: existingSessionId,
    });

    this.sessions.set(sessionKey, result.sessionId);

    if (result.response?.trim()) {
      const sentId = await channel.sendText(chatId, result.response, {
        parseMode: 'markdown',
        replyToId: message.id,
      });

      await this.eventBus.emit('message:sent', {
        message: {
          uuid: sentId,
          parentUuid: null,
          role: 'assistant' as const,
          content: result.response,
          createdAt: Date.now(),
        },
        channelId: channel.id,
      });
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
