/**
 * Sessions Repository
 */

import type { Database as BunSQLite, SQLQueryBindings } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import type { Session } from '@daemux/types';
import type { SessionRow } from './types';

type SQLBindings = SQLQueryBindings[];

export function createSessionsRepository(db: BunSQLite) {
  const mapRow = (row: SessionRow): Session => ({
    id: row.id,
    createdAt: row.created_at,
    lastActivity: row.last_activity,
    compactionCount: row.compaction_count,
    totalTokensUsed: row.total_tokens_used,
    queueMode: row.queue_mode as Session['queueMode'],
    activeChannelId: row.active_channel_id ?? undefined,
    currentTaskId: row.current_task_id ?? undefined,
    thinkingLevel: (row.thinking_level as Session['thinkingLevel']) ?? undefined,
    flags: JSON.parse(row.flags || '{}'),
  });

  return {
    create: (session: Omit<Session, 'id'>): Session => {
      const id = randomUUID();
      const now = Date.now();
      db.run(
        `INSERT INTO sessions (id, created_at, last_activity, compaction_count, total_tokens_used,
         queue_mode, active_channel_id, current_task_id, thinking_level, flags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          session.createdAt ?? now,
          session.lastActivity ?? now,
          session.compactionCount ?? 0,
          session.totalTokensUsed ?? 0,
          session.queueMode ?? 'steer',
          session.activeChannelId ?? null,
          session.currentTaskId ?? null,
          session.thinkingLevel ?? null,
          JSON.stringify(session.flags ?? {}),
        ]
      );
      return { id, ...session, createdAt: session.createdAt ?? now, lastActivity: session.lastActivity ?? now };
    },

    get: (id: string): Session | null => {
      const row = db.query('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | null;
      return row ? mapRow(row) : null;
    },

    update: function(id: string, updates: Partial<Session>): Session {
      const fields: string[] = [];
      const values: SQLQueryBindings[] = [];

      if (updates.lastActivity !== undefined) {
        fields.push('last_activity = ?');
        values.push(updates.lastActivity);
      }
      if (updates.compactionCount !== undefined) {
        fields.push('compaction_count = ?');
        values.push(updates.compactionCount);
      }
      if (updates.totalTokensUsed !== undefined) {
        fields.push('total_tokens_used = ?');
        values.push(updates.totalTokensUsed);
      }
      if (updates.queueMode !== undefined) {
        fields.push('queue_mode = ?');
        values.push(updates.queueMode);
      }
      if (updates.activeChannelId !== undefined) {
        fields.push('active_channel_id = ?');
        values.push(updates.activeChannelId);
      }
      if (updates.currentTaskId !== undefined) {
        fields.push('current_task_id = ?');
        values.push(updates.currentTaskId);
      }
      if (updates.thinkingLevel !== undefined) {
        fields.push('thinking_level = ?');
        values.push(updates.thinkingLevel);
      }
      if (updates.flags !== undefined) {
        fields.push('flags = ?');
        values.push(JSON.stringify(updates.flags));
      }

      if (fields.length > 0) {
        values.push(id);
        db.run(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`, values as SQLBindings);
      }

      const session = this.get(id);
      if (!session) throw new Error(`Session ${id} not found`);
      return session;
    },

    list: (options?: { limit?: number; offset?: number }): Session[] => {
      const limit = options?.limit ?? 100;
      const offset = options?.offset ?? 0;
      const rows = db.query(
        'SELECT * FROM sessions ORDER BY last_activity DESC LIMIT ? OFFSET ?'
      ).all(limit, offset) as SessionRow[];
      return rows.map(mapRow);
    },

    delete: (id: string): boolean => {
      const result = db.run('DELETE FROM sessions WHERE id = ?', [id]);
      return result.changes > 0;
    },

    getActive: (): Session | null => {
      const row = db.query(
        'SELECT * FROM sessions ORDER BY last_activity DESC LIMIT 1'
      ).get() as SessionRow | null;
      return row ? mapRow(row) : null;
    },
  };
}
