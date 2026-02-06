/**
 * CronService - Background Scheduler for Scheduled Tasks
 * Checks due schedules on an interval and triggers task execution.
 */

import type { Schedule, ScheduleType } from './types';
import type { Database } from '../infra/database';
import type { EventBus } from './event-bus';
import { getLogger } from '../infra/logger';
import {
  parseExpression,
  calcNextRun,
  recalcNextRunForExisting,
  toErrorMessage,
} from './cron-expression';

// Re-export parseExpression for external consumers
export { parseExpression } from './cron-expression';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHECK_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------------------
// CronService
// ---------------------------------------------------------------------------

export class CronService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private db: Database;
  private eventBus: EventBus;

  constructor(db: Database, eventBus: EventBus) {
    this.db = db;
    this.eventBus = eventBus;
  }

  /**
   * Start the background scheduler.
   * Recalculates nextRunMs for all enabled schedules, then starts
   * a 60-second interval that calls checkDue().
   */
  start(): void {
    this.recalculateAllNextRuns();

    this.timer = setInterval(() => {
      this.checkDue().catch((err: unknown) => {
        getLogger().error('CronService: checkDue failed', { error: toErrorMessage(err) });
      });
    }, CHECK_INTERVAL_MS);

    this.eventBus.emit('schedule:started', {}).catch(() => {});
    getLogger().info('CronService started', { intervalMs: CHECK_INTERVAL_MS });
  }

  /**
   * Stop the background scheduler.
   */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.eventBus.emit('schedule:stopped', {}).catch(() => {});
    getLogger().info('CronService stopped');
  }

  /**
   * Check for due schedules and execute them.
   * Called every 60s by the interval timer.
   */
  async checkDue(): Promise<void> {
    const dueSchedules = this.db.schedules.getDue();
    if (dueSchedules.length === 0) return;

    getLogger().debug(`CronService: ${dueSchedules.length} schedule(s) due`);

    for (const schedule of dueSchedules) {
      await this.executeSchedule(schedule);
    }
  }

  /**
   * Add a new schedule after validating the expression.
   * Returns the persisted schedule's ID.
   */
  async addSchedule(input: {
    type: ScheduleType;
    expression: string;
    taskTemplate: { subject: string; description: string };
    timezone?: string;
  }): Promise<string> {
    const nextRunMs = parseExpression(input.type, input.expression);

    const schedule = this.db.schedules.create({
      type: input.type,
      expression: input.expression,
      timezone: input.timezone ?? 'UTC',
      taskTemplate: input.taskTemplate,
      nextRunMs,
      enabled: true,
    });

    getLogger().info('Schedule added', {
      id: schedule.id,
      type: input.type,
      expression: input.expression,
      nextRunMs,
    });

    return schedule.id;
  }

  /**
   * Remove a schedule by ID.
   */
  async removeSchedule(id: string): Promise<void> {
    const deleted = this.db.schedules.delete(id);
    if (!deleted) {
      throw new Error(`Schedule ${id} not found`);
    }
    getLogger().info('Schedule removed', { id });
  }

  /**
   * List all schedules, optionally filtered by enabled status.
   * When `id` is provided, returns a single-element array or empty array.
   */
  listSchedules(filter?: { enabled?: boolean; id?: string }): Schedule[] {
    if (filter?.id) {
      const schedule = this.db.schedules.get(filter.id);
      return schedule ? [schedule] : [];
    }
    return this.db.schedules.list(filter);
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Execute a single due schedule: emit event, update lastRunMs,
   * calculate next run or disable if one-time.
   */
  private async executeSchedule(schedule: Schedule): Promise<void> {
    const now = Date.now();

    try {
      await this.eventBus.emit('schedule:triggered', {
        scheduleId: schedule.id,
        taskTemplate: schedule.taskTemplate,
      });

      getLogger().info('Schedule triggered', {
        id: schedule.id,
        type: schedule.type,
        subject: schedule.taskTemplate.subject,
      });
    } catch (err: unknown) {
      getLogger().error('Schedule execution failed', {
        id: schedule.id,
        error: toErrorMessage(err),
      });
    }

    const nextRunMs = calcNextRun(schedule.type, schedule.expression);

    if (nextRunMs === -1) {
      this.db.schedules.update(schedule.id, {
        lastRunMs: now,
        enabled: false,
      });
      getLogger().info('One-time schedule disabled after execution', {
        id: schedule.id,
      });
      return;
    }

    this.db.schedules.update(schedule.id, {
      lastRunMs: now,
      nextRunMs,
    });
  }

  /**
   * On startup, recalculate nextRunMs for all enabled schedules
   * to handle cases where the service was offline.
   */
  private recalculateAllNextRuns(): void {
    const schedules = this.db.schedules.list({ enabled: true });

    for (const schedule of schedules) {
      try {
        const nextRunMs = recalcNextRunForExisting(schedule);
        if (nextRunMs !== schedule.nextRunMs) {
          this.db.schedules.update(schedule.id, { nextRunMs });
        }
      } catch (err: unknown) {
        getLogger().warn('Failed to recalculate schedule nextRunMs', {
          id: schedule.id,
          error: toErrorMessage(err),
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Factory & Global Instance
// ---------------------------------------------------------------------------

let globalCronService: CronService | null = null;

export function createCronService(
  db: Database,
  eventBus: EventBus,
): CronService {
  globalCronService = new CronService(db, eventBus);
  return globalCronService;
}

export function getCronService(): CronService {
  if (!globalCronService) {
    throw new Error('CronService not initialized. Call createCronService first.');
  }
  return globalCronService;
}
