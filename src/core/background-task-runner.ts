/**
 * Background Task Runner
 * Spawns and tracks background AgenticLoop instances for delegated tasks.
 * Each task gets its own AgenticLoop with full BUILTIN_TOOLS.
 */

import { randomUUID } from 'crypto';
import { AgenticLoop } from './loop';
import { buildRetryPrompt } from './retry-prompt';
import type { Config } from './types';
import type { Database } from '../infra/database';
import type { EventBus } from './event-bus';
import type { LLMProvider } from './plugin-api-types';
import { getLogger } from '../infra/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface TaskInfo {
  id: string;
  description: string;
  chatKey: string;
  status: TaskStatus;
  startedAt: number;
  progress: string;
}

export type SpawnResult = {
  ok: true;
  taskId: string;
} | {
  ok: false;
  error: string;
};

export type TaskCompleteCallback = (taskId: string, result: string, success: boolean) => void;

// ---------------------------------------------------------------------------
// Internal Task Record
// ---------------------------------------------------------------------------

interface TaskRecord {
  id: string;
  description: string;
  chatKey: string;
  status: TaskStatus;
  startedAt: number;
  progress: string;
  loop: AgenticLoop | null;
  onComplete: TaskCompleteCallback;
  timeBudgetMs?: number;
}

// ---------------------------------------------------------------------------
// Background Task Runner
// ---------------------------------------------------------------------------

export class BackgroundTaskRunner {
  private tasks: Map<string, TaskRecord> = new Map();
  private cleanupTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private db: Database;
  private eventBus: EventBus;
  private config: Config;
  private provider: LLMProvider;
  private maxPerChat: number;
  private progressThrottleMs: number;
  private cleanupDelayMs: number;

  constructor(options: {
    db: Database;
    eventBus: EventBus;
    config: Config;
    provider: LLMProvider;
    maxPerChat?: number;
    progressThrottleMs?: number;
    cleanupDelayMs?: number;
  }) {
    this.db = options.db;
    this.eventBus = options.eventBus;
    this.config = options.config;
    this.provider = options.provider;
    this.maxPerChat = options.maxPerChat ?? 3;
    this.progressThrottleMs = options.progressThrottleMs ?? 30_000;
    this.cleanupDelayMs = options.cleanupDelayMs ?? 60_000;
  }

  spawn(
    description: string,
    chatKey: string,
    onComplete?: TaskCompleteCallback,
    options?: { timeBudgetMs?: number; failureContext?: string; retryCount?: number },
  ): SpawnResult {
    if (this.getTasksForChat(chatKey).length >= this.maxPerChat) {
      return { ok: false, error: `Concurrency limit reached (${this.maxPerChat} tasks max per chat)` };
    }

    const effectiveDescription = buildRetryPrompt(
      description, options?.failureContext, options?.retryCount ?? 0,
    );

    const taskId = randomUUID();
    const loop = new AgenticLoop({
      db: this.db,
      eventBus: this.eventBus,
      config: this.config,
      provider: this.provider,
    });

    const record: TaskRecord = {
      id: taskId,
      description: effectiveDescription,
      chatKey,
      status: 'running',
      startedAt: Date.now(),
      progress: '',
      loop,
      onComplete: onComplete ?? (() => {}),
      timeBudgetMs: options?.timeBudgetMs,
    };

    this.tasks.set(taskId, record);

    void this.eventBus.emit('bg-task:delegated', { taskId, chatKey, description: effectiveDescription });
    this.startTask(record);

    return { ok: true, taskId };
  }

  cancel(taskId: string): boolean {
    const record = this.tasks.get(taskId);
    if (!record || record.status !== 'running') return false;

    record.status = 'cancelled';
    if (record.loop) record.loop.interrupt();
    void this.eventBus.emit('bg-task:completed', {
      taskId, chatKey: record.chatKey, result: 'Task cancelled', success: false,
    });
    record.onComplete(record.id, 'Task cancelled', false);
    this.scheduleCleanup(record);
    return true;
  }

  getTask(taskId: string): TaskInfo | null {
    const record = this.tasks.get(taskId);
    if (!record) return null;
    return this.toInfo(record);
  }

  getTasksForChat(chatKey: string): TaskInfo[] {
    const results: TaskInfo[] = [];
    for (const record of this.tasks.values()) {
      if (record.chatKey === chatKey && record.status === 'running') {
        results.push(this.toInfo(record));
      }
    }
    return results;
  }

  stopAll(): void {
    for (const record of this.tasks.values()) {
      if (record.status === 'running') {
        record.status = 'cancelled';
        if (record.loop) record.loop.interrupt();
        record.loop = null;
      }
    }
    this.tasks.clear();
    for (const timer of this.cleanupTimers.values()) clearTimeout(timer);
    this.cleanupTimers.clear();
    getLogger().info('BackgroundTaskRunner: all tasks stopped');
  }

  // -----------------------------------------------------------------------
  // Private Helpers
  // -----------------------------------------------------------------------

  private startTask(record: TaskRecord): void {
    let lastProgressAt = 0;
    const onStream = (chunk: { type: string; content?: string }) => {
      if (chunk.type !== 'text' || !chunk.content) return;
      const now = Date.now();
      if (now - lastProgressAt < this.progressThrottleMs) return;
      lastProgressAt = now;
      record.progress = chunk.content.slice(0, 200);
      void this.eventBus.emit('bg-task:progress', {
        taskId: record.id, chatKey: record.chatKey, text: record.progress,
      });
    };

    const loopConfig: { onStream: typeof onStream; timeoutMs?: number } = { onStream };
    if (record.timeBudgetMs) {
      loopConfig.timeoutMs = record.timeBudgetMs;
    }

    record.loop!.run(record.description, loopConfig)
      .then(result => {
        if (record.status === 'cancelled') return;
        const response = result.response || 'Task completed with no output';
        this.finalizeTask(record, 'completed', response, response);
      })
      .catch(err => {
        if (record.status === 'cancelled') return;
        const errorMsg = err instanceof Error ? err.message : String(err);
        getLogger().error('Background task failed', { taskId: record.id, error: errorMsg });
        this.finalizeTask(record, 'failed', errorMsg, `Task failed: ${errorMsg}`);
      });
  }

  private finalizeTask(
    record: TaskRecord, status: 'completed' | 'failed', eventResult: string, callbackResult: string,
  ): void {
    record.status = status;
    record.loop = null;
    void this.eventBus.emit('bg-task:completed', {
      taskId: record.id, chatKey: record.chatKey, result: eventResult, success: status === 'completed',
    });
    record.onComplete(record.id, callbackResult, status === 'completed');
    this.scheduleCleanup(record);
  }

  private scheduleCleanup(record: TaskRecord): void {
    record.loop = null;
    const timer = setTimeout(() => {
      this.tasks.delete(record.id);
      this.cleanupTimers.delete(record.id);
    }, this.cleanupDelayMs);
    this.cleanupTimers.set(record.id, timer);
  }

  private toInfo(record: TaskRecord): TaskInfo {
    return {
      id: record.id,
      description: record.description,
      chatKey: record.chatKey,
      status: record.status,
      startedAt: record.startedAt,
      progress: record.progress,
    };
  }
}
