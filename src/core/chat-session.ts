/**
 * Chat Session
 * Manages dialog state for one chat. Owns a lightweight dialog AgenticLoop
 * and a reference to the BackgroundTaskRunner for task delegation.
 * Serializes messages within a single chat using a mutex queue.
 */

import { AgenticLoop } from './loop';
import { DIALOG_TOOLS, createDialogToolExecutors } from './dialog-tools';
import type { BackgroundTaskRunner } from './background-task-runner';
import type { Config, ToolResult } from './types';
import type { Database } from '../infra/database';
import type { EventBus } from './event-bus';
import type { LLMProvider } from './plugin-api-types';
import type { EnhancedChannel, RichChannelMessage } from './channel-types';
import { classifyError } from './error-classify';
import { getLogger } from '../infra/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DIALOG_SYSTEM_PROMPT =
  'You are a helpful AI assistant in a chat conversation. ' +
  'For simple questions, answer directly in a conversational tone. ' +
  'For complex tasks that require file operations, code execution, or multi-step work, ' +
  'use the delegate_task tool to spawn a background worker. ' +
  'You can check on running tasks with list_tasks and cancel them with cancel_task. ' +
  'When a background task completes, the user will be notified automatically.';

const DIALOG_MAX_ITERATIONS = 2;

// ---------------------------------------------------------------------------
// Queue Item
// ---------------------------------------------------------------------------

interface QueueItem {
  text: string;
  message: RichChannelMessage;
  resolve: () => void;
}

// ---------------------------------------------------------------------------
// Chat Session
// ---------------------------------------------------------------------------

export class ChatSession {
  private chatKey: string;
  private dialogLoop: AgenticLoop;
  private taskRunner: BackgroundTaskRunner;
  private eventBus: EventBus;
  private sessionId: string | undefined;
  private queue: QueueItem[] = [];
  private processing = false;
  private stopped = false;
  private channel: EnhancedChannel;
  private chatId: string;
  private toolExecutors: Map<string, (id: string, input: Record<string, unknown>) => Promise<ToolResult>>;
  private unsubscribers: Array<() => void> = [];

  constructor(options: {
    chatKey: string;
    chatId: string;
    channel: EnhancedChannel;
    db: Database;
    eventBus: EventBus;
    config: Config;
    provider: LLMProvider;
    taskRunner: BackgroundTaskRunner;
  }) {
    this.chatKey = options.chatKey;
    this.chatId = options.chatId;
    this.channel = options.channel;
    this.eventBus = options.eventBus;
    this.taskRunner = options.taskRunner;

    this.dialogLoop = new AgenticLoop({
      db: options.db,
      eventBus: options.eventBus,
      config: options.config,
      provider: options.provider,
    });

    this.toolExecutors = createDialogToolExecutors(this.taskRunner, this.chatKey);
    this.registerTaskCompletionHandler();
  }

  async handleMessage(text: string, message: RichChannelMessage): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queue.push({ text, message, resolve });
      if (!this.processing) {
        void this.processNext();
      }
    });
  }

  getActiveTasks(): ReturnType<BackgroundTaskRunner['getTasksForChat']> {
    return this.taskRunner.getTasksForChat(this.chatKey);
  }

  stop(): void {
    this.stopped = true;
    this.queue = [];
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    if (this.dialogLoop.isRunning()) {
      this.dialogLoop.interrupt();
    }
  }

  // -----------------------------------------------------------------------
  // Private: Queue Processing
  // -----------------------------------------------------------------------

  private async processNext(): Promise<void> {
    if (this.stopped || this.queue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const item = this.queue.shift()!;

    try {
      await this.processDialogMessage(item);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      getLogger().error('Dialog message processing failed', {
        chatKey: this.chatKey, error: errorMsg,
      });
      try {
        await this.channel.sendText(this.chatId, classifyError(errorMsg));
      } catch {
        // Swallow send errors during error handling
      }
    }

    item.resolve();

    if (!this.stopped) {
      void this.processNext();
    }
  }

  private async processDialogMessage(item: QueueItem): Promise<void> {
    const result = await this.dialogLoop.run(item.text, {
      sessionId: this.sessionId,
      systemPrompt: DIALOG_SYSTEM_PROMPT,
      tools: DIALOG_TOOLS,
      toolExecutors: this.toolExecutors,
      maxIterations: DIALOG_MAX_ITERATIONS,
    });

    this.sessionId = result.sessionId;

    if (result.response?.trim()) {
      const sentId = await this.channel.sendText(this.chatId, result.response, {
        parseMode: 'markdown',
        replyToId: item.message.id,
      });

      await this.eventBus.emit('message:sent', {
        message: {
          uuid: sentId,
          parentUuid: null,
          role: 'assistant' as const,
          content: result.response,
          createdAt: Date.now(),
        },
        channelId: this.channel.id,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Private: Task Completion Wiring
  // -----------------------------------------------------------------------

  private registerTaskCompletionHandler(): void {
    const unsub = this.eventBus.on('bg-task:completed', async (payload) => {
      if (payload.chatKey !== this.chatKey) return;
      if (this.stopped) return;

      try {
        const prefix = payload.success ? 'Task completed' : 'Task failed';
        const text = `${prefix}:\n\n${payload.result}`;
        const truncated = text.length > 4000 ? `${text.slice(0, 4000)}...` : text;
        await this.channel.sendText(this.chatId, truncated, { parseMode: 'markdown' });
      } catch (err) {
        getLogger().error('Failed to send task completion message', {
          chatKey: this.chatKey,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
    this.unsubscribers.push(unsub);
  }
}

