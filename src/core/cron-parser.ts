/**
 * Minimal Cron Expression Parser
 * Parses standard 5-field cron expressions and calculates next run time.
 *
 * Fields: minute(0-59) hour(0-23) day(1-31) month(1-12) weekday(0-6, 0=Sunday)
 * Supports: * (any), 5 (specific), 1,3,5 (list), 1-5 (range), step (e.g. *​ / 15)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CronFields {
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
}

// ---------------------------------------------------------------------------
// Field Parsing
// ---------------------------------------------------------------------------

const FIELD_RANGES: readonly [number, number][] = [
  [0, 59],  // minute
  [0, 23],  // hour
  [1, 31],  // day
  [1, 12],  // month
  [0, 6],   // weekday
];

/**
 * Parse a single cron field token (e.g. "5", "1-5", "1,3,5")
 * into a Set of matching integer values within [min, max].
 */
function parseField(token: string, min: number, max: number): Set<number> {
  const result = new Set<number>();

  for (const part of token.split(',')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;

    if (trimmed.includes('/')) {
      addStepValues(result, trimmed, min, max);
    } else if (trimmed.includes('-')) {
      addRangeValues(result, trimmed, min, max);
    } else if (trimmed === '*') {
      for (let i = min; i <= max; i++) result.add(i);
    } else {
      const num = parseInt(trimmed, 10);
      if (!Number.isNaN(num) && num >= min && num <= max) {
        result.add(num);
      }
    }
  }

  if (result.size === 0) {
    throw new Error(`Invalid cron field: "${token}" (range ${min}-${max})`);
  }
  return result;
}

function addStepValues(
  result: Set<number>,
  token: string,
  min: number,
  max: number,
): void {
  const slashIndex = token.indexOf('/');
  const baseToken = token.substring(0, slashIndex);
  const stepStr = token.substring(slashIndex + 1);
  const step = parseInt(stepStr, 10);

  if (Number.isNaN(step) || step <= 0) {
    throw new Error(`Invalid step value in "${token}"`);
  }

  let start = min;
  let end = max;

  if (baseToken !== '*') {
    if (baseToken.includes('-')) {
      const dashIndex = baseToken.indexOf('-');
      const lo = parseInt(baseToken.substring(0, dashIndex), 10);
      const hi = parseInt(baseToken.substring(dashIndex + 1), 10);
      if (!Number.isNaN(lo)) start = Math.max(lo, min);
      if (!Number.isNaN(hi)) end = Math.min(hi, max);
    } else {
      const v = parseInt(baseToken, 10);
      if (!Number.isNaN(v)) start = Math.max(v, min);
    }
  }

  for (let i = start; i <= end; i += step) {
    result.add(i);
  }
}

function addRangeValues(
  result: Set<number>,
  token: string,
  min: number,
  max: number,
): void {
  const dashIndex = token.indexOf('-');
  const loStr = token.substring(0, dashIndex);
  const hiStr = token.substring(dashIndex + 1);
  const lo = Math.max(parseInt(loStr, 10), min);
  const hi = Math.min(parseInt(hiStr, 10), max);

  if (Number.isNaN(lo) || Number.isNaN(hi)) {
    throw new Error(`Invalid range in "${token}"`);
  }

  for (let i = lo; i <= hi; i++) {
    result.add(i);
  }
}

// ---------------------------------------------------------------------------
// Expression Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a 5-field cron expression into structured field sets.
 * Throws if the expression is malformed.
 */
export function parseCronExpression(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `Cron expression must have 5 fields, got ${parts.length}: "${expression}"`,
    );
  }

  const fieldNames: (keyof CronFields)[] = ['minutes', 'hours', 'days', 'months', 'weekdays'];
  const fields = {} as CronFields;

  for (let i = 0; i < 5; i++) {
    const [min, max] = FIELD_RANGES[i]!;
    fields[fieldNames[i]!] = parseField(parts[i]!, min, max);
  }

  return fields;
}

// ---------------------------------------------------------------------------
// Next Run Calculation
// ---------------------------------------------------------------------------

/** Maximum lookahead: 366 days in minutes */
const MAX_ITERATIONS = 366 * 24 * 60;

/**
 * Given a cron expression string, find the next timestamp (ms) after `fromMs`
 * that matches all fields. Starts scanning from one minute after `fromMs`.
 *
 * Returns the timestamp in milliseconds.
 * Throws if no match is found within 366 days.
 */
export function nextCronRun(expression: string, fromMs: number): number {
  const fields = parseCronExpression(expression);
  return findNextMatch(fields, fromMs);
}

function findNextMatch(fields: CronFields, fromMs: number): number {
  const start = new Date(fromMs);
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);

  const cursor = new Date(start.getTime());

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (matchesAllFields(fields, cursor)) {
      return cursor.getTime();
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }

  throw new Error(
    'No matching cron time found within 366 days for expression',
  );
}

function matchesAllFields(fields: CronFields, date: Date): boolean {
  return (
    fields.minutes.has(date.getUTCMinutes()) &&
    fields.hours.has(date.getUTCHours()) &&
    fields.days.has(date.getUTCDate()) &&
    fields.months.has(date.getUTCMonth() + 1) &&
    fields.weekdays.has(date.getUTCDay())
  );
}
