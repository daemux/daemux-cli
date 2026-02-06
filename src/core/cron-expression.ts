/**
 * Cron Expression Parsing Helpers
 * Parses 'at', 'every', and 'cron' schedule expressions into timestamps.
 */

import type { ScheduleType, Schedule } from './types';
import { nextCronRun } from './cron-parser';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INTERVAL_UNITS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

// ---------------------------------------------------------------------------
// Parsing Helpers
// ---------------------------------------------------------------------------

/**
 * Parse an 'at' expression (ISO-8601 datetime string) into a timestamp (ms).
 * Example: "2024-12-25 09:00" or "2024-12-25T09:00:00Z"
 */
function parseAtExpression(expression: string): number {
  const normalized = expression.includes('T') ? expression : expression.replace(' ', 'T');
  const ts = new Date(normalized).getTime();
  if (Number.isNaN(ts)) {
    throw new Error(`Invalid 'at' expression: "${expression}"`);
  }
  return ts;
}

/**
 * Parse an 'every' expression (e.g. "30m", "2h", "1d", "45s")
 * and return the interval in milliseconds.
 */
function parseEveryInterval(expression: string): number {
  const match = expression.match(/^(\d+)\s*([smhd])$/);
  if (!match) {
    throw new Error(
      `Invalid 'every' expression: "${expression}". Expected format: <number><s|m|h|d>`,
    );
  }
  const amountStr = match[1] ?? '';
  const unit = match[2] ?? '';
  const amount = parseInt(amountStr, 10);
  const multiplier = INTERVAL_UNITS[unit];
  if (!multiplier || amount <= 0) {
    throw new Error(`Invalid interval amount or unit in "${expression}"`);
  }
  return amount * multiplier;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calculate the next run timestamp for a given schedule type and expression.
 * For 'at': the fixed datetime timestamp.
 * For 'every': Date.now() + parsed interval.
 * For 'cron': next matching minute via cron parser.
 */
export function parseExpression(
  type: ScheduleType,
  expression: string,
): number {
  switch (type) {
    case 'at':
      return parseAtExpression(expression);
    case 'every':
      return Date.now() + parseEveryInterval(expression);
    case 'cron':
      return nextCronRun(expression, Date.now());
    default:
      throw new Error(`Unknown schedule type: "${type as string}"`);
  }
}

/**
 * Calculate the next run time after a schedule has fired.
 * For 'at': returns -1 (one-time, should be disabled).
 * For 'every': now + interval.
 * For 'cron': next cron match from now.
 */
export function calcNextRun(type: ScheduleType, expression: string): number {
  if (type === 'at') return -1;
  return parseExpression(type, expression);
}

/**
 * Recalculate nextRunMs for an existing schedule.
 * For 'at' schedules, keeps the original timestamp.
 * For recurring schedules, recalculates from now if the stored time is in the past.
 */
export function recalcNextRunForExisting(schedule: Schedule): number {
  if (schedule.type === 'at') {
    return schedule.nextRunMs;
  }

  if (schedule.nextRunMs > Date.now()) {
    return schedule.nextRunMs;
  }

  return parseExpression(schedule.type, schedule.expression);
}

export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
