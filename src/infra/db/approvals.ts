/**
 * Approvals Repository
 */

import type { Database as BunSQLite, SQLQueryBindings } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import type { ApprovalRequest } from '@daemux/types';
import type { ApprovalRow } from './types';

type SQLBindings = SQLQueryBindings[];

export function createApprovalsRepository(db: BunSQLite) {
  const mapRow = (row: ApprovalRow): ApprovalRequest => ({
    id: row.id,
    command: row.command,
    context: row.context ? JSON.parse(row.context) : undefined,
    createdAtMs: row.created_at_ms,
    expiresAtMs: row.expires_at_ms,
    decision: row.decision as ApprovalRequest['decision'],
    decidedAtMs: row.decided_at_ms ?? undefined,
    decidedBy: row.decided_by ?? undefined,
  });

  return {
    create: (request: Omit<ApprovalRequest, 'id'>): ApprovalRequest => {
      const id = randomUUID();

      db.run(
        `INSERT INTO approvals (id, command, context, created_at_ms, expires_at_ms, decision, decided_at_ms, decided_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          request.command,
          request.context ? JSON.stringify(request.context) : null,
          request.createdAtMs,
          request.expiresAtMs,
          request.decision,
          request.decidedAtMs ?? null,
          request.decidedBy ?? null,
        ]
      );

      return { id, ...request };
    },

    get: (id: string): ApprovalRequest | null => {
      const row = db.query('SELECT * FROM approvals WHERE id = ?').get(id) as ApprovalRow | null;
      return row ? mapRow(row) : null;
    },

    update: function(id: string, updates: Partial<ApprovalRequest>): ApprovalRequest {
      const fields: string[] = [];
      const values: SQLQueryBindings[] = [];

      if (updates.decision !== undefined) {
        fields.push('decision = ?');
        values.push(updates.decision);
      }
      if (updates.decidedAtMs !== undefined) {
        fields.push('decided_at_ms = ?');
        values.push(updates.decidedAtMs);
      }
      if (updates.decidedBy !== undefined) {
        fields.push('decided_by = ?');
        values.push(updates.decidedBy);
      }

      if (fields.length > 0) {
        values.push(id);
        db.run(`UPDATE approvals SET ${fields.join(', ')} WHERE id = ?`, values as SQLBindings);
      }

      const request = this.get(id);
      if (!request) throw new Error(`Approval ${id} not found`);
      return request;
    },

    getPending: (): ApprovalRequest[] => {
      const rows = db.query(
        'SELECT * FROM approvals WHERE decision IS NULL ORDER BY created_at_ms ASC'
      ).all() as ApprovalRow[];
      return rows.map(mapRow);
    },

    getExpired: (): ApprovalRequest[] => {
      const now = Date.now();
      const rows = db.query(
        'SELECT * FROM approvals WHERE decision IS NULL AND expires_at_ms < ?'
      ).all(now) as ApprovalRow[];
      return rows.map(mapRow);
    },
  };
}
