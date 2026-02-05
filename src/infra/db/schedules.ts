/**
 * Schedules Repository
 */

import type { Database as BunSQLite, SQLQueryBindings } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import type { Schedule } from '../../core/types';
import type { ScheduleRow } from './types';

type SQLBindings = SQLQueryBindings[];

export function createSchedulesRepository(db: BunSQLite) {
  const mapRow = (row: ScheduleRow): Schedule => ({
    id: row.id,
    type: row.type as Schedule['type'],
    expression: row.expression,
    timezone: row.timezone,
    taskTemplate: JSON.parse(row.task_template),
    nextRunMs: row.next_run_ms,
    lastRunMs: row.last_run_ms ?? undefined,
    enabled: row.enabled === 1,
  });

  return {
    create: (schedule: Omit<Schedule, 'id'>): Schedule => {
      const id = randomUUID();

      db.run(
        `INSERT INTO schedules (id, type, expression, timezone, task_template, next_run_ms, last_run_ms, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          schedule.type,
          schedule.expression,
          schedule.timezone ?? 'UTC',
          JSON.stringify(schedule.taskTemplate),
          schedule.nextRunMs,
          schedule.lastRunMs ?? null,
          schedule.enabled ? 1 : 0,
        ]
      );

      return { id, ...schedule };
    },

    get: (id: string): Schedule | null => {
      const row = db.query('SELECT * FROM schedules WHERE id = ?').get(id) as ScheduleRow | null;
      return row ? mapRow(row) : null;
    },

    update: function(id: string, updates: Partial<Schedule>): Schedule {
      const fields: string[] = [];
      const values: SQLQueryBindings[] = [];

      if (updates.expression !== undefined) {
        fields.push('expression = ?');
        values.push(updates.expression);
      }
      if (updates.nextRunMs !== undefined) {
        fields.push('next_run_ms = ?');
        values.push(updates.nextRunMs);
      }
      if (updates.lastRunMs !== undefined) {
        fields.push('last_run_ms = ?');
        values.push(updates.lastRunMs);
      }
      if (updates.enabled !== undefined) {
        fields.push('enabled = ?');
        values.push(updates.enabled ? 1 : 0);
      }
      if (updates.taskTemplate !== undefined) {
        fields.push('task_template = ?');
        values.push(JSON.stringify(updates.taskTemplate));
      }

      if (fields.length > 0) {
        values.push(id);
        db.run(`UPDATE schedules SET ${fields.join(', ')} WHERE id = ?`, values as SQLBindings);
      }

      const schedule = this.get(id);
      if (!schedule) throw new Error(`Schedule ${id} not found`);
      return schedule;
    },

    list: (filter?: { enabled?: boolean }): Schedule[] => {
      let query = 'SELECT * FROM schedules WHERE 1=1';
      const params: SQLQueryBindings[] = [];

      if (filter?.enabled !== undefined) {
        query += ' AND enabled = ?';
        params.push(filter.enabled ? 1 : 0);
      }

      query += ' ORDER BY next_run_ms ASC';
      const rows = db.query(query).all(...(params as SQLBindings)) as ScheduleRow[];
      return rows.map(mapRow);
    },

    getDue: (): Schedule[] => {
      const now = Date.now();
      const rows = db.query(
        'SELECT * FROM schedules WHERE enabled = 1 AND next_run_ms <= ? ORDER BY next_run_ms ASC'
      ).all(now) as ScheduleRow[];
      return rows.map(mapRow);
    },

    delete: (id: string): boolean => {
      const result = db.run('DELETE FROM schedules WHERE id = ?', [id]);
      return result.changes > 0;
    },
  };
}
