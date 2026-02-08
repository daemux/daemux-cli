/**
 * Legacy Channel Handler
 * Handles queue-based message processing for backward-compatible loop-based mode.
 * Extracted from ChannelRouter to keep function count within limits.
 */

import type { AgenticLoop } from './loop';
import type { EventBus } from './event-bus';
import type { EnhancedChannel, RichChannelMessage } from './channel-types';
import type { Logger } from '../infra/logger';
import { classifyError } from './error-classify';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LegacyQueueItem {
  message: RichChannelMessage;
  channel: EnhancedChannel;
  text: string;
}

export type ChatIdResolver = (message: RichChannelMessage) => string;

// ---------------------------------------------------------------------------
// Legacy Channel Handler
// ---------------------------------------------------------------------------

export class LegacyChannelHandler {
  private queue: LegacyQueueItem[] = [];
  private processing = false;
  private sessions: Map<string, string> = new Map();
  private stopped = false;
  private loop: AgenticLoop;
  private eventBus: EventBus;
  private logger: Logger;
  private resolveChatId: ChatIdResolver;

  constructor(options: {
    loop: AgenticLoop;
    eventBus: EventBus;
    logger: Logger;
    resolveChatId: ChatIdResolver;
  }) {
    this.loop = options.loop;
    this.eventBus = options.eventBus;
    this.logger = options.logger;
    this.resolveChatId = options.resolveChatId;
  }

  enqueue(item: LegacyQueueItem): void {
    this.queue.push(item);
    if (!this.processing) void this.processNext();
  }

  clearQueue(): void {
    this.queue = [];
  }

  stop(): void {
    this.stopped = true;
    this.queue = [];
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

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
        const userMessage = classifyError(errorMsg);
        await item.channel.sendText(chatId, userMessage);
      } catch {
        // Swallow send errors during error handling
      }
    }

    if (!this.stopped) void this.processNext();
  }

  private async processMessage(item: LegacyQueueItem): Promise<void> {
    const { message, channel, text } = item;
    const chatId = this.resolveChatId(message);
    const sessionKey = `${channel.id}:${chatId}`;
    const existingSessionId = this.sessions.get(sessionKey);

    const result = await this.loop.run(text, { sessionId: existingSessionId });
    this.sessions.set(sessionKey, result.sessionId);

    if (result.response?.trim()) {
      const sentId = await channel.sendText(chatId, result.response, {
        parseMode: 'markdown', replyToId: message.id,
      });
      await this.eventBus.emit('message:sent', {
        message: {
          uuid: sentId, parentUuid: null, role: 'assistant' as const,
          content: result.response, createdAt: Date.now(),
        },
        channelId: channel.id,
      });
    }
  }
}
