/** Manages dialog state for one chat with queue-serialized message processing. */

import { AgenticLoop } from './loop';
import { DIALOG_TOOLS, createDialogToolExecutors } from './dialog-tools';
import type { BackgroundTaskRunner } from './background-task-runner';
import type { Config, ToolResult } from './types';
import type { Database } from '../infra/database';
import type { EventBus } from './event-bus';
import type { LLMProvider } from './plugin-api-types';
import type { EnhancedChannel, RichChannelMessage } from './channel-types';
import type { AgentRegistry } from './agent-registry';
import type { AgentFactory } from './agent-factory';
import type { ComplexityClassifier } from './complexity-classifier';
import { SwarmCoordinator } from './swarm';
import { classifyError } from './error-classify';
import { getLogger } from '../infra/logger';

const DIALOG_SYSTEM_PROMPT =
  'You are a helpful AI assistant in a chat conversation. ' +
  'For simple questions, answer directly in a conversational tone. ' +
  'For complex tasks that require file operations, code execution, or multi-step work, ' +
  'use the delegate_task tool to spawn a background worker. ' +
  'You can check on running tasks with list_tasks and cancel them with cancel_task. ' +
  'When a background task completes, the user will be notified automatically.';

interface QueueItem {
  text: string;
  message: RichChannelMessage;
  resolve: () => void;
}

export interface SwarmDeps {
  registry: AgentRegistry;
  agentFactory: AgentFactory;
  complexityClassifier: ComplexityClassifier;
}

export class ChatSession {
  private chatKey: string;
  private dialogLoop: AgenticLoop;
  private taskRunner: BackgroundTaskRunner;
  private eventBus: EventBus;
  private config: Config;
  private provider: LLMProvider;
  private sessionId: string | undefined;
  private queue: QueueItem[] = [];
  private processing = false;
  private stopped = false;
  private channel: EnhancedChannel;
  private chatId: string;
  private toolExecutors: Map<string, (id: string, input: Record<string, unknown>) => Promise<ToolResult>>;
  private unsubscribers: Array<() => void> = [];
  private swarmDeps: SwarmDeps | null = null;
  private activeSwarm: SwarmCoordinator | null = null;

  constructor(options: {
    chatKey: string;
    chatId: string;
    channel: EnhancedChannel;
    db: Database;
    eventBus: EventBus;
    config: Config;
    provider: LLMProvider;
    taskRunner: BackgroundTaskRunner;
    swarmDeps?: SwarmDeps;
  }) {
    this.chatKey = options.chatKey;
    this.chatId = options.chatId;
    this.channel = options.channel;
    this.eventBus = options.eventBus;
    this.config = options.config;
    this.provider = options.provider;
    this.taskRunner = options.taskRunner;
    this.swarmDeps = options.swarmDeps ?? null;

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
    if (this.activeSwarm) {
      this.activeSwarm.stop();
      this.activeSwarm = null;
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
    // Check if swarm should handle this task
    if (this.swarmDeps) {
      const complexity = await this.swarmDeps.complexityClassifier.classify(item.text);
      if (complexity === 'complex') {
        await this.handleWithSwarm(item);
        return;
      }
    }

    const result = await this.dialogLoop.run(item.text, {
      sessionId: this.sessionId,
      systemPrompt: DIALOG_SYSTEM_PROMPT,
      tools: DIALOG_TOOLS,
      toolExecutors: this.toolExecutors,
    });

    this.sessionId = result.sessionId;

    if (result.response?.trim()) {
      await this.sendResponse(result.response, item.message.id);
    }
  }

  // -----------------------------------------------------------------------
  // Private: Swarm Handling
  // -----------------------------------------------------------------------

  private async handleWithSwarm(item: QueueItem): Promise<void> {
    if (!this.swarmDeps) return;

    const logger = getLogger();
    logger.info('Routing complex task to swarm', { chatKey: this.chatKey });

    try {
      await this.channel.sendText(this.chatId, 'Working on this complex task with multiple agents...');

      const swarm = new SwarmCoordinator({
        eventBus: this.eventBus,
        config: { maxAgents: 3, timeoutMs: 600_000 },
        provider: this.provider,
        registry: this.swarmDeps.registry,
        agentFactory: this.swarmDeps.agentFactory,
      });

      this.activeSwarm = swarm;
      const swarmResult = await swarm.execute(item.text);
      this.activeSwarm = null;

      const output = swarmResult.output.length > 4000
        ? `${swarmResult.output.slice(0, 4000)}...`
        : swarmResult.output;
      const elapsed = Math.round(swarmResult.durationMs / 1000);
      const response = `Task ${swarmResult.status} (${elapsed}s):\n\n${output}`;
      await this.sendResponse(response, item.message.id);
    } catch (err) {
      this.activeSwarm = null;
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Swarm execution failed', { chatKey: this.chatKey, error: errorMsg });
      await this.channel.sendText(this.chatId, `Swarm task failed: ${classifyError(errorMsg)}`);
    }
  }

  // -----------------------------------------------------------------------
  // Private: Response Sending
  // -----------------------------------------------------------------------

  private async sendResponse(text: string, replyToId: string): Promise<void> {
    const sentId = await this.channel.sendText(this.chatId, text, {
      parseMode: 'markdown',
      replyToId,
    });

    await this.eventBus.emit('message:sent', {
      message: {
        uuid: sentId,
        parentUuid: null,
        role: 'assistant' as const,
        content: text,
        createdAt: Date.now(),
      },
      channelId: this.channel.id,
    });
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
