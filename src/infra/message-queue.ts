/**
 * Message Queue with Multiple Modes
 * Supports steer, interrupt, queue, and collect modes for handling concurrent messages
 */

import { randomUUID } from 'crypto';
import type { QueueMode, QueuedMessage } from '../core/types';
import { getLogger } from './logger';

// ---------------------------------------------------------------------------
// Queue Configuration
// ---------------------------------------------------------------------------

export interface MessageQueueConfig {
  mode: QueueMode;
  collectWindowMs?: number;
  maxQueueSize?: number;
}

export interface IncomingMessage {
  content: string;
  channelId?: string;
  senderId?: string;
  priority?: number;
}

export type MessageHandler = (messages: QueuedMessage[]) => Promise<void>;

// ---------------------------------------------------------------------------
// Message Queue Class
// ---------------------------------------------------------------------------

export class MessageQueue {
  private mode: QueueMode;
  private collectWindowMs: number;
  private maxQueueSize: number;
  private queue: QueuedMessage[] = [];
  private processing = false;
  private handler: MessageHandler | null = null;
  private collectTimer: ReturnType<typeof setTimeout> | null = null;
  private collectBuffer: QueuedMessage[] = [];
  private interruptCallback: (() => void) | null = null;
  private logger = getLogger().child('message-queue');

  constructor(config: MessageQueueConfig) {
    this.mode = config.mode;
    this.collectWindowMs = config.collectWindowMs ?? 5000;
    this.maxQueueSize = config.maxQueueSize ?? 100;
  }

  setMode(mode: QueueMode): void {
    this.mode = mode;
    this.logger.debug('Queue mode changed', { mode });
  }

  getMode(): QueueMode {
    return this.mode;
  }

  setHandler(handler: MessageHandler): void {
    this.handler = handler;
  }

  setInterruptCallback(callback: () => void): void {
    this.interruptCallback = callback;
  }

  async add(message: IncomingMessage): Promise<QueuedMessage> {
    const queued: QueuedMessage = {
      id: randomUUID(),
      content: message.content,
      channelId: message.channelId,
      senderId: message.senderId,
      priority: message.priority ?? 0,
      queuedAt: Date.now(),
      cancelled: false,
    };

    this.logger.debug('Message added to queue', {
      id: queued.id,
      mode: this.mode,
      queueSize: this.queue.length,
    });

    switch (this.mode) {
      case 'steer':
        await this.handleSteerMode(queued);
        break;
      case 'interrupt':
        await this.handleInterruptMode(queued);
        break;
      case 'queue':
        await this.handleQueueMode(queued);
        break;
      case 'collect':
        await this.handleCollectMode(queued);
        break;
    }

    return queued;
  }

  private async handleSteerMode(message: QueuedMessage): Promise<void> {
    // In steer mode, new messages add context to current session
    // They're immediately processed alongside current work
    if (this.processing && this.handler) {
      // Deliver immediately as steering input
      await this.handler([message]);
    } else {
      // No active processing, queue and process
      this.queue.push(message);
      await this.processNext();
    }
  }

  private async handleInterruptMode(message: QueuedMessage): Promise<void> {
    // In interrupt mode, new messages stop current task
    if (this.processing) {
      // Signal interruption
      if (this.interruptCallback) {
        this.interruptCallback();
      }
      this.logger.info('Interrupting current task for new message', { messageId: message.id });
    }

    // Clear queue and add new message at front
    this.queue = [message];
    await this.processNext();
  }

  private async handleQueueMode(message: QueuedMessage): Promise<void> {
    // In queue mode, messages wait in FIFO order
    if (this.queue.length >= this.maxQueueSize) {
      this.logger.warn('Queue is full, dropping oldest message', {
        maxSize: this.maxQueueSize,
        droppedId: this.queue[0]?.id,
      });
      this.queue.shift();
    }

    // Insert by priority (higher priority first)
    const insertIndex = this.queue.findIndex(m => m.priority < message.priority);
    if (insertIndex === -1) {
      this.queue.push(message);
    } else {
      this.queue.splice(insertIndex, 0, message);
    }

    // Start processing if not already
    if (!this.processing) {
      await this.processNext();
    }
  }

  private async handleCollectMode(message: QueuedMessage): Promise<void> {
    // In collect mode, batch messages within time window
    this.collectBuffer.push(message);

    if (this.collectTimer) {
      // Timer already running, message will be included in batch
      return;
    }

    // Start collect timer
    this.collectTimer = setTimeout(async () => {
      this.collectTimer = null;

      if (this.collectBuffer.length === 0) return;

      const batch = [...this.collectBuffer];
      this.collectBuffer = [];

      this.logger.debug('Processing collected batch', { count: batch.length });

      if (this.handler) {
        this.processing = true;
        try {
          await this.handler(batch);
        } finally {
          this.processing = false;
        }
      }
    }, this.collectWindowMs);
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    if (!this.handler) {
      this.logger.warn('No handler registered, messages will wait');
      return;
    }

    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const message = this.queue.shift();
        if (!message || message.cancelled) continue;

        message.processedAt = Date.now();

        this.logger.debug('Processing message', {
          id: message.id,
          waitTime: message.processedAt - message.queuedAt,
        });

        await this.handler([message]);
      }
    } finally {
      this.processing = false;
    }
  }

  cancel(messageId: string): boolean {
    const message = this.queue.find(m => m.id === messageId);
    if (message) {
      message.cancelled = true;
      this.logger.debug('Message cancelled', { id: messageId });
      return true;
    }

    const bufferedMessage = this.collectBuffer.find(m => m.id === messageId);
    if (bufferedMessage) {
      bufferedMessage.cancelled = true;
      this.logger.debug('Buffered message cancelled', { id: messageId });
      return true;
    }

    return false;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getBufferLength(): number {
    return this.collectBuffer.length;
  }

  isProcessing(): boolean {
    return this.processing;
  }

  peek(): QueuedMessage | undefined {
    return this.queue[0];
  }

  clear(): void {
    const count = this.queue.length + this.collectBuffer.length;
    this.queue = [];
    this.collectBuffer = [];

    if (this.collectTimer) {
      clearTimeout(this.collectTimer);
      this.collectTimer = null;
    }

    this.logger.debug('Queue cleared', { messagesCleared: count });
  }

  getStats(): QueueStats {
    return {
      mode: this.mode,
      queueLength: this.queue.length,
      bufferLength: this.collectBuffer.length,
      processing: this.processing,
      oldestMessageAge: this.queue[0] ? Date.now() - this.queue[0].queuedAt : 0,
    };
  }
}

export interface QueueStats {
  mode: QueueMode;
  queueLength: number;
  bufferLength: number;
  processing: boolean;
  oldestMessageAge: number;
}

// ---------------------------------------------------------------------------
// Factory Function
// ---------------------------------------------------------------------------

export function createMessageQueue(config: MessageQueueConfig): MessageQueue {
  return new MessageQueue(config);
}
