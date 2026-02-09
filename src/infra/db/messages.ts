/**
 * Messages Repository
 */

import type { Database as BunSQLite, SQLQueryBindings } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import type { Message } from '@daemux/types';
import type { MessageRow } from './types';

type SQLBindings = SQLQueryBindings[];

export function createMessagesRepository(db: BunSQLite) {
  const mapRow = (row: MessageRow): Message => {
    let content: Message['content'];
    try {
      content = JSON.parse(row.content);
    } catch {
      content = row.content;
    }

    return {
      uuid: row.uuid,
      parentUuid: row.parent_uuid,
      role: row.role as Message['role'],
      content,
      createdAt: row.created_at,
      tokenCount: row.token_count ?? undefined,
    };
  };

  return {
    create: (sessionId: string, message: Omit<Message, 'uuid'>): Message => {
      const uuid = randomUUID();
      const content = typeof message.content === 'string'
        ? message.content
        : JSON.stringify(message.content);

      db.run(
        `INSERT INTO messages (uuid, session_id, parent_uuid, role, content, created_at, token_count)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [uuid, sessionId, message.parentUuid, message.role, content, message.createdAt, message.tokenCount ?? null]
      );
      return { uuid, ...message };
    },

    get: (uuid: string): Message | null => {
      const row = db.query('SELECT * FROM messages WHERE uuid = ?').get(uuid) as MessageRow | null;
      return row ? mapRow(row) : null;
    },

    list: (sessionId: string, options?: { limit?: number; offset?: number; afterUuid?: string }): Message[] => {
      const limit = options?.limit ?? 1000;
      const offset = options?.offset ?? 0;

      let query = 'SELECT * FROM messages WHERE session_id = ?';
      const params: SQLQueryBindings[] = [sessionId];

      if (options?.afterUuid) {
        query += ' AND created_at > (SELECT created_at FROM messages WHERE uuid = ?)';
        params.push(options.afterUuid);
      }

      query += ' ORDER BY created_at ASC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const rows = db.query(query).all(...(params as SQLBindings)) as MessageRow[];
      return rows.map(mapRow);
    },

    delete: (uuid: string): boolean => {
      const result = db.run('DELETE FROM messages WHERE uuid = ?', [uuid]);
      return result.changes > 0;
    },

    deleteSession: (sessionId: string): number => {
      const result = db.run('DELETE FROM messages WHERE session_id = ?', [sessionId]);
      return result.changes;
    },

    validateChain: function(sessionId: string): { valid: boolean; brokenAt?: string } {
      const messages = this.list(sessionId);
      const seen = new Set<string>();

      for (const msg of messages) {
        if (seen.has(msg.uuid)) {
          return { valid: false, brokenAt: msg.uuid };
        }
        seen.add(msg.uuid);
      }
      return { valid: true };
    },

    getTokenCount: (sessionId: string): number => {
      const result = db.query(
        'SELECT SUM(token_count) as total FROM messages WHERE session_id = ? AND token_count IS NOT NULL'
      ).get(sessionId) as { total: number | null };
      return result?.total ?? 0;
    },
  };
}
