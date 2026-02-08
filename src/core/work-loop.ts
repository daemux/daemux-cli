/**
 * Work Loop - Autonomous Task Processing Engine
 * Continuously polls for pending tasks, claims them, executes via AgenticLoop,
 * and handles verification, failure, and retry.
 */

import type { Config, Task } from './types';
import type { Database } from '../infra/database';
import type { EventBus } from './event-bus';
import type { LLMProvider } from './plugin-api-types';
import type { TaskManager } from './task-manager';
import type { CronService } from './cron-service';
import { AgenticLoop } from './loop';
import { TaskVerifier } from './task-verifier';
import { buildRetryPrompt } from './retry-prompt';
import { getLogger } from '../infra/logger';

// ---------------------------------------------------------------------------
// Budget Tracker - Sliding window rate limiter
// ---------------------------------------------------------------------------

class BudgetTracker {
  private timestamps: number[] = [];
  private maxPerHour: number;

  constructor(maxPerHour: number) {
    this.maxPerHour = maxPerHour;
  }

  canDispatch(): boolean {
    this.cleanup();
    return this.timestamps.length < this.maxPerHour;
  }

  record(): void {
    this.timestamps.push(Date.now());
  }

  get count(): number {
    this.cleanup();
    return this.timestamps.length;
  }

  private cleanup(): void {
    const oneHourAgo = Date.now() - 3_600_000;
    this.timestamps = this.timestamps.filter(t => t > oneHourAgo);
  }
}

// ---------------------------------------------------------------------------
// Work Loop Options
// ---------------------------------------------------------------------------

export interface WorkLoopOptions {
  db: Database;
  eventBus: EventBus;
  config: Config;
  provider: LLMProvider;
  taskManager: TaskManager;
  cronService?: CronService;
}

// ---------------------------------------------------------------------------
// Work Loop Class
// ---------------------------------------------------------------------------

export class WorkLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Map<string, AgenticLoop> = new Map();
  private budgetTracker: BudgetTracker;
  private taskVerifier: TaskVerifier;
  private isRunning = false;

  private readonly db: Database;
  private readonly eventBus: EventBus;
  private readonly config: Config;
  private readonly provider: LLMProvider;
  private readonly taskManager: TaskManager;
  private readonly cronService: CronService | null;

  constructor(options: WorkLoopOptions) {
    this.db = options.db;
    this.eventBus = options.eventBus;
    this.config = options.config;
    this.provider = options.provider;
    this.taskManager = options.taskManager;
    this.cronService = options.cronService ?? null;
    this.budgetTracker = new BudgetTracker(options.config.workBudgetMaxTasksPerHour);
    this.taskVerifier = new TaskVerifier({
      eventBus: options.eventBus,
      taskManager: options.taskManager,
    });
  }

  /**
   * Start the autonomous work loop.
   * Begins polling for tasks at the configured interval.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.taskVerifier.start();
    if (this.cronService) this.cronService.start();

    this.timer = setInterval(() => {
      this.poll().catch(err => {
        getLogger().error('WorkLoop: poll failed', { error: String(err) });
      });
    }, this.config.workPollingIntervalMs);

    // Immediate first poll
    this.poll().catch(err => {
      getLogger().error('WorkLoop: initial poll failed', { error: String(err) });
    });

    void this.eventBus.emit('work:started', {
      pollingIntervalMs: this.config.workPollingIntervalMs,
      maxConcurrent: this.config.maxConcurrentTasks,
    });

    getLogger().info('WorkLoop started', {
      pollingIntervalMs: this.config.workPollingIntervalMs,
      maxConcurrent: this.config.maxConcurrentTasks,
      budgetLimit: this.config.workBudgetMaxTasksPerHour,
    });
  }

  /**
   * Stop the work loop gracefully.
   * Interrupts all running loops and resets in-progress tasks to pending.
   */
  async stop(reason?: string): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.taskVerifier.stop();
    if (this.cronService) this.cronService.stop();

    // Interrupt all running AgenticLoop instances
    for (const [taskId, loop] of this.running.entries()) {
      loop.interrupt();
      await this.resetTaskToPending(taskId);
    }
    this.running.clear();

    await this.eventBus.emit('work:stopped', { reason });
    getLogger().info('WorkLoop stopped', { reason });
  }

  /**
   * Check if the work loop is currently active.
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get the number of currently running tasks.
   */
  getRunningCount(): number {
    return this.running.size;
  }

  // -------------------------------------------------------------------------
  // Private: Polling
  // -------------------------------------------------------------------------

  private async poll(): Promise<void> {
    if (!this.isRunning) return;

    // Check budget
    if (!this.budgetTracker.canDispatch()) {
      await this.eventBus.emit('work:budget-exhausted', {
        tasksThisHour: this.budgetTracker.count,
        limit: this.config.workBudgetMaxTasksPerHour,
      });
      return;
    }

    // Calculate free slots
    const freeSlots = this.config.maxConcurrentTasks - this.running.size;
    if (freeSlots <= 0) {
      await this.emitPollStatus(0);
      return;
    }

    // Get available tasks (pending, unblocked, unclaimed)
    const available = this.taskManager.getAvailable('work-loop');
    await this.emitPollStatus(available.length);

    if (available.length === 0) return;

    // Dispatch up to freeSlots tasks
    const toDispatch = available.slice(0, freeSlots);
    for (const task of toDispatch) {
      if (!this.budgetTracker.canDispatch()) break;
      await this.dispatchTask(task);
    }
  }

  // -------------------------------------------------------------------------
  // Private: Task Dispatch
  // -------------------------------------------------------------------------

  private async dispatchTask(task: Task): Promise<void> {
    try {
      await this.taskManager.claim(task.id, 'work-loop');
    } catch {
      // Another instance may have claimed it
      getLogger().debug('WorkLoop: failed to claim task', { taskId: task.id });
      return;
    }

    const prompt = buildRetryPrompt(task.description, task.failureContext, task.retryCount);

    const loop = new AgenticLoop({
      db: this.db,
      eventBus: this.eventBus,
      config: this.config,
      provider: this.provider,
    });

    this.running.set(task.id, loop);
    this.budgetTracker.record();

    await this.eventBus.emit('work:task-dispatched', {
      taskId: task.id,
      subject: task.subject,
    });

    getLogger().info('WorkLoop: dispatching task', {
      taskId: task.id,
      subject: task.subject,
      retryCount: task.retryCount,
    });

    // Execute asynchronously - don't await in poll
    this.executeTask(task, loop, prompt);
  }

  // -------------------------------------------------------------------------
  // Private: Task Execution
  // -------------------------------------------------------------------------

  private executeTask(task: Task, loop: AgenticLoop, prompt: string): void {
    const startTime = Date.now();

    loop.run(prompt, {
      timeoutMs: task.timeBudgetMs,
      maxIterations: this.config.workMaxIterationsPerTask,
    })
      .then(async result => {
        if (!this.isRunning) return;
        const response = result.response || 'Task completed with no output';
        getLogger().info('WorkLoop: task completed', { taskId: task.id, response: response.slice(0, 200) });
        await this.taskManager.complete(task.id);
        await this.emitTaskCompleted(task, true, startTime);
      })
      .catch(async err => {
        if (!this.isRunning) return;
        const errorMsg = err instanceof Error ? err.message : String(err);
        getLogger().error('WorkLoop: task failed', { taskId: task.id, error: errorMsg });
        await this.taskManager.fail(task.id, errorMsg);
        await this.emitTaskCompleted(task, false, startTime);
      })
      .finally(() => {
        this.running.delete(task.id);
      });
  }

  // -------------------------------------------------------------------------
  // Private: Helpers
  // -------------------------------------------------------------------------

  private async resetTaskToPending(taskId: string): Promise<void> {
    try {
      const task = this.taskManager.get(taskId);
      if (task && task.status === 'in_progress') {
        await this.taskManager.update(taskId, { status: 'pending', clearOwner: true });
        getLogger().info('WorkLoop: reset task to pending on stop', { taskId });
      }
    } catch (err) {
      getLogger().warn('WorkLoop: failed to reset task', { taskId, error: String(err) });
    }
  }

  private async emitTaskCompleted(task: Task, success: boolean, startTime: number): Promise<void> {
    await this.eventBus.emit('work:task-completed', {
      taskId: task.id,
      subject: task.subject,
      success,
      durationMs: Date.now() - startTime,
    });
  }

  private async emitPollStatus(availableTasks: number): Promise<void> {
    await this.eventBus.emit('work:poll', {
      availableTasks,
      runningTasks: this.running.size,
    });
  }
}

// ---------------------------------------------------------------------------
// Global Instance
// ---------------------------------------------------------------------------

let globalWorkLoop: WorkLoop | null = null;

export function createWorkLoop(options: WorkLoopOptions): WorkLoop {
  globalWorkLoop = new WorkLoop(options);
  return globalWorkLoop;
}

export function getWorkLoop(): WorkLoop {
  if (!globalWorkLoop) {
    throw new Error('WorkLoop not initialized. Call createWorkLoop first.');
  }
  return globalWorkLoop;
}
