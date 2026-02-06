/**
 * Heartbeat Manager - Periodic Self-Check System
 * Monitors agent state and emits events for autonomous action planning
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import type { Config, Task } from './types';
import type { EventBus } from './event-bus';
import type { TaskManager } from './task-manager';
import type { Logger } from '../infra/logger';

// ---------------------------------------------------------------------------
// Heartbeat Context
// ---------------------------------------------------------------------------

export interface HeartbeatContext {
  goals: string | null;
  pendingTasks: Task[];
  stalledTasks: Task[];
  timestamp: number;
  lastActivity: number | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STALLED_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const HEARTBEAT_FILE_NAME = 'HEARTBEAT.md';
const DAEMUX_DIR = '.daemux';

// ---------------------------------------------------------------------------
// Heartbeat Manager Class
// ---------------------------------------------------------------------------

export class HeartbeatManager {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastActivityTimestamp: number | null = null;

  constructor(
    private config: Config,
    private taskManager: TaskManager,
    private eventBus: EventBus,
    private logger: Logger,
  ) {}

  /**
   * Start the heartbeat interval.
   * Only starts if heartbeatEnabled is true in config.
   * Runs the first beat immediately, then at the configured interval.
   */
  start(): void {
    if (!this.config.heartbeatEnabled) {
      this.logger.debug('Heartbeat disabled by config, not starting');
      return;
    }

    if (this.timer !== null) {
      this.logger.warn('Heartbeat already running, ignoring start()');
      return;
    }

    const intervalMs = this.config.heartbeatIntervalMs;

    this.timer = setInterval(() => {
      void this.beat();
    }, intervalMs);

    void this.eventBus.emit('heartbeat:started', {
      intervalMs,
    });

    this.logger.info('Heartbeat started', { intervalMs });

    // Run first beat immediately
    void this.beat();
  }

  /**
   * Stop the heartbeat interval and clear the timer.
   */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    void this.eventBus.emit('heartbeat:stopped', {});

    this.logger.info('Heartbeat stopped');
  }

  /**
   * Execute a single heartbeat check.
   * Reads goals, gathers tasks, builds context, and emits a check event.
   */
  async beat(): Promise<void> {
    try {
      const heartbeatContent = await this.readHeartbeatFile();
      const pendingTasks = this.taskManager.list({ status: 'pending' });
      const inProgressTasks = this.taskManager.getInProgress();
      const allTasks = [...pendingTasks, ...inProgressTasks];

      const context = this.buildContext(heartbeatContent, allTasks);

      await this.eventBus.emit('heartbeat:check', { context });

      this.logger.info('Heartbeat check completed', {
        hasGoals: heartbeatContent !== null,
        pendingCount: context.pendingTasks.length,
        stalledCount: context.stalledTasks.length,
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error('Heartbeat check failed', { error: errorMessage });
    }
  }

  /**
   * Read the HEARTBEAT.md file from the working directory.
   * Tries .daemux/HEARTBEAT.md first, falls back to ./HEARTBEAT.md.
   * Returns null if neither file exists.
   */
  async readHeartbeatFile(): Promise<string | null> {
    const cwd = process.cwd();
    return await this.tryReadFile(join(cwd, DAEMUX_DIR, HEARTBEAT_FILE_NAME))
      ?? this.tryReadFile(join(cwd, HEARTBEAT_FILE_NAME));
  }

  /**
   * Build the heartbeat context from goals and task data.
   * Identifies stalled tasks (in_progress with no update in >1 hour).
   */
  buildContext(heartbeatContent: string | null, tasks: Task[]): HeartbeatContext {
    const now = Date.now();
    const stalledThreshold = now - STALLED_THRESHOLD_MS;

    const pendingTasks = tasks.filter(
      (task) => task.status === 'pending',
    );

    const stalledTasks = tasks.filter(
      (task) =>
        task.status === 'in_progress' && task.updatedAt < stalledThreshold,
    );

    return {
      goals: heartbeatContent,
      pendingTasks,
      stalledTasks,
      timestamp: now,
      lastActivity: this.lastActivityTimestamp,
    };
  }

  /**
   * Update the last activity timestamp.
   * Called externally when the agent performs any action.
   */
  recordActivity(): void {
    this.lastActivityTimestamp = Date.now();
  }

  /**
   * Check whether the heartbeat timer is currently active.
   */
  isRunning(): boolean {
    return this.timer !== null;
  }

  /**
   * Attempt to read a file, returning null on any error.
   */
  private async tryReadFile(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Factory & Global Instance
// ---------------------------------------------------------------------------

let globalHeartbeatManager: HeartbeatManager | null = null;

export function createHeartbeatManager(
  config: Config,
  taskManager: TaskManager,
  eventBus: EventBus,
  logger: Logger,
): HeartbeatManager {
  globalHeartbeatManager = new HeartbeatManager(config, taskManager, eventBus, logger);
  return globalHeartbeatManager;
}

export function getHeartbeatManager(): HeartbeatManager {
  if (!globalHeartbeatManager) {
    throw new Error('Heartbeat manager not initialized. Call createHeartbeatManager first.');
  }
  return globalHeartbeatManager;
}
