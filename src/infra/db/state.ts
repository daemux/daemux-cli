/**
 * State (Key-Value) Repository
 */

import type { Database as BunSQLite, SQLQueryBindings } from 'bun:sqlite';

type SQLBindings = SQLQueryBindings[];

export function createStateRepository(db: BunSQLite) {
  return {
    get: <T>(key: string): T | undefined => {
      const row = db.query('SELECT value FROM state WHERE key = ?').get(key) as { value: string } | null;
      if (!row) return undefined;
      return JSON.parse(row.value) as T;
    },

    set: <T>(key: string, value: T): void => {
      const now = Date.now();
      db.run(
        'INSERT OR REPLACE INTO state (key, value, updated_at) VALUES (?, ?, ?)',
        [key, JSON.stringify(value), now]
      );
    },

    delete: (key: string): boolean => {
      const result = db.run('DELETE FROM state WHERE key = ?', [key]);
      return result.changes > 0;
    },

    list: (prefix?: string): Array<{ key: string; value: unknown }> => {
      let query = 'SELECT key, value FROM state';
      const params: SQLQueryBindings[] = [];

      if (prefix) {
        query += ' WHERE key LIKE ?';
        params.push(`${prefix}%`);
      }

      const rows = db.query(query).all(...(params as SQLBindings)) as Array<{ key: string; value: string }>;
      return rows.map(row => ({ key: row.key, value: JSON.parse(row.value) }));
    },
  };
}
