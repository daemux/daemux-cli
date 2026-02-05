/**
 * Memory (Vector Search) Repository
 */

import type { Database as BunSQLite } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import type { MemoryEntry } from '../../core/types';
import type { MemoryRow } from './types';

export function createMemoryRepository(db: BunSQLite, vecEnabled: boolean) {
  const mapRow = (row: MemoryRow): MemoryEntry => ({
    id: row.id,
    content: row.content,
    metadata: JSON.parse(row.metadata || '{}'),
    createdAt: row.created_at,
  });

  return {
    store: (entry: Omit<MemoryEntry, 'id'>): MemoryEntry => {
      const id = randomUUID();

      db.run(
        'INSERT INTO memory (id, content, metadata, created_at) VALUES (?, ?, ?, ?)',
        [id, entry.content, JSON.stringify(entry.metadata ?? {}), entry.createdAt]
      );

      return { id, ...entry, metadata: entry.metadata ?? {} };
    },

    storeWithEmbedding: function(entry: Omit<MemoryEntry, 'id'>, embedding: Float32Array): MemoryEntry {
      const stored = this.store(entry);

      if (vecEnabled) {
        db.run(
          'INSERT INTO memory_vec (id, embedding) VALUES (?, ?)',
          [stored.id, new Uint8Array(embedding.buffer)]
        );
      }

      return stored;
    },

    get: (id: string): MemoryEntry | null => {
      const row = db.query('SELECT * FROM memory WHERE id = ?').get(id) as MemoryRow | null;
      return row ? mapRow(row) : null;
    },

    search: (embedding: Float32Array, limit = 10): MemoryEntry[] => {
      if (!vecEnabled) {
        console.warn('[database] Vector search not available - sqlite-vec not loaded');
        return [];
      }

      const rows = db.query(`
        SELECT m.*, v.distance
        FROM memory_vec v
        JOIN memory m ON m.id = v.id
        WHERE v.embedding MATCH ?
        ORDER BY v.distance
        LIMIT ?
      `).all(new Uint8Array(embedding.buffer), limit) as (MemoryRow & { distance: number })[];

      return rows.map(mapRow);
    },

    delete: (id: string): boolean => {
      if (vecEnabled) {
        db.run('DELETE FROM memory_vec WHERE id = ?', [id]);
      }
      const result = db.run('DELETE FROM memory WHERE id = ?', [id]);
      return result.changes > 0;
    },

    compact: (olderThanMs: number): number => {
      const threshold = Date.now() - olderThanMs;

      if (vecEnabled) {
        db.run(
          'DELETE FROM memory_vec WHERE id IN (SELECT id FROM memory WHERE created_at < ?)',
          [threshold]
        );
      }

      const result = db.run('DELETE FROM memory WHERE created_at < ?', [threshold]);
      return result.changes;
    },
  };
}
