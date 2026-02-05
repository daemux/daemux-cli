/**
 * Audit Repository
 */

import type { Database as BunSQLite, SQLQueryBindings } from 'bun:sqlite';
import type { AuditEntry } from '../../core/types';
import type { AuditRow } from './types';

type SQLBindings = SQLQueryBindings[];

export function createAuditRepository(db: BunSQLite) {
  return {
    log: (entry: Omit<AuditEntry, 'id' | 'timestamp'>): void => {
      const now = Date.now();
      db.run(
        'INSERT INTO audit (timestamp, action, target, user_id, agent_id, result, details) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          now,
          entry.action,
          entry.target ?? null,
          entry.userId ?? null,
          entry.agentId ?? null,
          entry.result,
          entry.details ? JSON.stringify(entry.details) : null,
        ]
      );
    },

    query: (filter: {
      action?: string;
      userId?: string;
      agentId?: string;
      fromMs?: number;
      toMs?: number;
      limit?: number;
    }): AuditEntry[] => {
      let query = 'SELECT * FROM audit WHERE 1=1';
      const params: SQLQueryBindings[] = [];

      if (filter.action) {
        query += ' AND action = ?';
        params.push(filter.action);
      }
      if (filter.userId) {
        query += ' AND user_id = ?';
        params.push(filter.userId);
      }
      if (filter.agentId) {
        query += ' AND agent_id = ?';
        params.push(filter.agentId);
      }
      if (filter.fromMs) {
        query += ' AND timestamp >= ?';
        params.push(filter.fromMs);
      }
      if (filter.toMs) {
        query += ' AND timestamp <= ?';
        params.push(filter.toMs);
      }

      query += ' ORDER BY timestamp DESC LIMIT ?';
      params.push(filter.limit ?? 100);

      const rows = db.query(query).all(...(params as SQLBindings)) as AuditRow[];
      return rows.map(row => ({
        id: row.id,
        timestamp: row.timestamp,
        action: row.action,
        target: row.target ?? undefined,
        userId: row.user_id ?? undefined,
        agentId: row.agent_id ?? undefined,
        result: row.result as AuditEntry['result'],
        details: row.details ? JSON.parse(row.details) : undefined,
      }));
    },
  };
}
