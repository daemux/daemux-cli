/**
 * Subagents Repository
 */

import type { Database as BunSQLite, SQLQueryBindings } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import type { SubagentRecord } from '../../core/types';
import type { SubagentRow } from './types';

type SQLBindings = SQLQueryBindings[];

export function createSubagentsRepository(db: BunSQLite) {
  const mapRow = (row: SubagentRow): SubagentRecord => ({
    id: row.id,
    agentName: row.agent_name,
    parentId: row.parent_id,
    taskDescription: row.task_description,
    pid: row.pid ?? undefined,
    status: row.status as SubagentRecord['status'],
    spawnedAt: row.spawned_at,
    completedAt: row.completed_at ?? undefined,
    timeoutMs: row.timeout_ms,
    result: row.result ?? undefined,
    tokensUsed: row.tokens_used ?? undefined,
    toolUses: row.tool_uses ?? undefined,
  });

  return {
    create: (record: Omit<SubagentRecord, 'id'>): SubagentRecord => {
      const id = randomUUID();

      db.run(
        `INSERT INTO subagents (id, agent_name, parent_id, task_description, pid, status, spawned_at, timeout_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, record.agentName, record.parentId, record.taskDescription, record.pid ?? null, record.status, record.spawnedAt, record.timeoutMs]
      );

      return { id, ...record };
    },

    get: (id: string): SubagentRecord | null => {
      const row = db.query('SELECT * FROM subagents WHERE id = ?').get(id) as SubagentRow | null;
      return row ? mapRow(row) : null;
    },

    update: function(id: string, updates: Partial<SubagentRecord>): SubagentRecord {
      const fields: string[] = [];
      const values: SQLQueryBindings[] = [];

      if (updates.status !== undefined) {
        fields.push('status = ?');
        values.push(updates.status);
      }
      if (updates.completedAt !== undefined) {
        fields.push('completed_at = ?');
        values.push(updates.completedAt);
      }
      if (updates.result !== undefined) {
        fields.push('result = ?');
        values.push(updates.result);
      }
      if (updates.tokensUsed !== undefined) {
        fields.push('tokens_used = ?');
        values.push(updates.tokensUsed);
      }
      if (updates.toolUses !== undefined) {
        fields.push('tool_uses = ?');
        values.push(updates.toolUses);
      }
      if (updates.pid !== undefined) {
        fields.push('pid = ?');
        values.push(updates.pid);
      }

      if (fields.length > 0) {
        values.push(id);
        db.run(`UPDATE subagents SET ${fields.join(', ')} WHERE id = ?`, values as SQLBindings);
      }

      const record = this.get(id);
      if (!record) throw new Error(`Subagent ${id} not found`);
      return record;
    },

    list: (filter?: { status?: string; parentId?: string }): SubagentRecord[] => {
      let query = 'SELECT * FROM subagents WHERE 1=1';
      const params: SQLQueryBindings[] = [];

      if (filter?.status) {
        query += ' AND status = ?';
        params.push(filter.status);
      }
      if (filter?.parentId) {
        query += ' AND parent_id = ?';
        params.push(filter.parentId);
      }

      query += ' ORDER BY spawned_at DESC';
      const rows = db.query(query).all(...(params as SQLBindings)) as SubagentRow[];
      return rows.map(mapRow);
    },

    getRunning: (): SubagentRecord[] => {
      const rows = db.query(
        "SELECT * FROM subagents WHERE status = 'running'"
      ).all() as SubagentRow[];
      return rows.map(mapRow);
    },

    markOrphaned: (olderThanMs: number): number => {
      const threshold = Date.now() - olderThanMs;
      const result = db.run(
        "UPDATE subagents SET status = 'orphaned' WHERE status = 'running' AND spawned_at < ?",
        [threshold]
      );
      return result.changes;
    },
  };
}
