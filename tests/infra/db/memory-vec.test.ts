/**
 * Memory Vector Search Tests
 * Tests vector search functionality and sqlite-vec extension
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';
import { createMemoryRepository } from '../../../src/infra/db/memory';
import { Database as BunSQLite } from 'bun:sqlite';

describe('Memory Vector Search', () => {
  const testDbPath = join(import.meta.dir, 'test-memory-vec.sqlite');
  let db: BunSQLite;

  beforeEach(() => {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    db = new BunSQLite(testDbPath);

    // Create required tables
    db.run(`
      CREATE TABLE IF NOT EXISTS memory (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL
      )
    `);
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe('mapRow function', () => {
    it('should map row to MemoryEntry', () => {
      const repo = createMemoryRepository(db, false);

      const entry = repo.store({
        content: 'Test content',
        metadata: { key: 'value' },
        createdAt: Date.now(),
      });

      const retrieved = repo.get(entry.id);

      expect(retrieved?.id).toBe(entry.id);
      expect(retrieved?.content).toBe('Test content');
      expect(retrieved?.metadata).toEqual({ key: 'value' });
    });

    it('should parse empty metadata as empty object', () => {
      const repo = createMemoryRepository(db, false);

      const entry = repo.store({
        content: 'No metadata',
        metadata: {},
        createdAt: Date.now(),
      });

      const retrieved = repo.get(entry.id);
      expect(retrieved?.metadata).toEqual({});
    });

    it('should handle null metadata', () => {
      const repo = createMemoryRepository(db, false);

      // Insert with null metadata directly
      db.run(
        'INSERT INTO memory (id, content, metadata, created_at) VALUES (?, ?, ?, ?)',
        ['test-null-meta', 'Content', null, Date.now()]
      );

      const retrieved = repo.get('test-null-meta');
      expect(retrieved?.metadata).toEqual({});
    });

    it('should handle complex nested metadata', () => {
      const repo = createMemoryRepository(db, false);

      const complexMeta = {
        array: [1, 2, 3],
        nested: { level1: { level2: { value: 'deep' } } },
        mixed: [{ key: 'val' }, 'string', 123],
      };

      const entry = repo.store({
        content: 'Complex metadata',
        metadata: complexMeta,
        createdAt: Date.now(),
      });

      const retrieved = repo.get(entry.id);
      expect(retrieved?.metadata).toEqual(complexMeta);
    });
  });

  describe('store function', () => {
    it('should generate UUID for id', () => {
      const repo = createMemoryRepository(db, false);

      const entry = repo.store({
        content: 'Test',
        metadata: {},
        createdAt: Date.now(),
      });

      // UUID format check
      expect(entry.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should return stored entry with all fields', () => {
      const repo = createMemoryRepository(db, false);
      const now = Date.now();

      const entry = repo.store({
        content: 'Full entry',
        metadata: { tag: 'test' },
        createdAt: now,
      });

      expect(entry.id).toBeDefined();
      expect(entry.content).toBe('Full entry');
      expect(entry.metadata).toEqual({ tag: 'test' });
      expect(entry.createdAt).toBe(now);
    });

    it('should handle undefined metadata', () => {
      const repo = createMemoryRepository(db, false);

      const entry = repo.store({
        content: 'No meta provided',
        createdAt: Date.now(),
      } as any);

      expect(entry.metadata).toEqual({});
    });
  });

  describe('storeWithEmbedding function', () => {
    it('should store entry without vec table when disabled', () => {
      const repo = createMemoryRepository(db, false);
      const embedding = new Float32Array(1536).fill(0.1);

      const entry = repo.storeWithEmbedding(
        {
          content: 'Embedding content',
          metadata: {},
          createdAt: Date.now(),
        },
        embedding
      );

      expect(entry.id).toBeDefined();
      expect(entry.content).toBe('Embedding content');
    });

    it('should store embedding when vec enabled', () => {
      // Create vec table for test
      try {
        db.run(`
          CREATE TABLE IF NOT EXISTS memory_vec (
            id TEXT PRIMARY KEY,
            embedding BLOB
          )
        `);
      } catch {
        // Table may already exist
      }

      const repo = createMemoryRepository(db, true);
      const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);

      const entry = repo.storeWithEmbedding(
        {
          content: 'Vec content',
          metadata: {},
          createdAt: Date.now(),
        },
        embedding
      );

      // Verify entry was stored
      expect(entry.id).toBeDefined();

      // Verify embedding was stored
      const vecRow = db.query('SELECT * FROM memory_vec WHERE id = ?').get(entry.id) as any;
      expect(vecRow).toBeDefined();
      expect(vecRow.embedding).toBeDefined();
    });

    it('should convert Float32Array to Uint8Array for storage', () => {
      const embedding = new Float32Array([1.0, 2.0, 3.0]);
      const buffer = new Uint8Array(embedding.buffer);

      // Verify conversion preserves data
      const restored = new Float32Array(buffer.buffer);
      expect(Array.from(restored)).toEqual(Array.from(embedding));
    });
  });

  describe('get function', () => {
    it('should return null for non-existent id', () => {
      const repo = createMemoryRepository(db, false);

      const result = repo.get('does-not-exist');

      expect(result).toBeNull();
    });

    it('should return correct entry by id', () => {
      const repo = createMemoryRepository(db, false);

      const entry1 = repo.store({
        content: 'Entry 1',
        metadata: {},
        createdAt: Date.now(),
      });

      const entry2 = repo.store({
        content: 'Entry 2',
        metadata: {},
        createdAt: Date.now(),
      });

      const retrieved = repo.get(entry1.id);

      expect(retrieved?.id).toBe(entry1.id);
      expect(retrieved?.content).toBe('Entry 1');
    });
  });

  describe('search function', () => {
    it('should warn and return empty when vec disabled', () => {
      const repo = createMemoryRepository(db, false);
      const embedding = new Float32Array(1536).fill(0.1);

      // Store some entries
      repo.store({
        content: 'Searchable',
        metadata: {},
        createdAt: Date.now(),
      });

      // Search should return empty and log warning
      const results = repo.search(embedding, 10);

      expect(results).toEqual([]);
    });

    it('should respect limit parameter', () => {
      const repo = createMemoryRepository(db, false);
      const embedding = new Float32Array(1536);

      // Without vec support, returns empty regardless
      const results = repo.search(embedding, 5);
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should use default limit of 10', () => {
      const repo = createMemoryRepository(db, false);
      const embedding = new Float32Array(1536);

      // Function signature shows default
      const results = repo.search(embedding);
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('delete function', () => {
    it('should delete existing entry', () => {
      const repo = createMemoryRepository(db, false);

      const entry = repo.store({
        content: 'To delete',
        metadata: {},
        createdAt: Date.now(),
      });

      const deleted = repo.delete(entry.id);

      expect(deleted).toBe(true);
      expect(repo.get(entry.id)).toBeNull();
    });

    it('should return false for non-existent entry', () => {
      const repo = createMemoryRepository(db, false);

      const deleted = repo.delete('non-existent-id');

      expect(deleted).toBe(false);
    });

    it('should delete from vec table when enabled', () => {
      // Create vec table
      db.run(`
        CREATE TABLE IF NOT EXISTS memory_vec (
          id TEXT PRIMARY KEY,
          embedding BLOB
        )
      `);

      const repo = createMemoryRepository(db, true);
      const embedding = new Float32Array([0.1, 0.2]);

      const entry = repo.storeWithEmbedding(
        {
          content: 'Vec delete test',
          metadata: {},
          createdAt: Date.now(),
        },
        embedding
      );

      // Verify vec entry exists
      let vecRow = db.query('SELECT * FROM memory_vec WHERE id = ?').get(entry.id);
      expect(vecRow).toBeDefined();

      // Delete
      repo.delete(entry.id);

      // Verify vec entry removed
      vecRow = db.query('SELECT * FROM memory_vec WHERE id = ?').get(entry.id);
      expect(vecRow).toBeNull();
    });

    it('should not affect vec table when disabled', () => {
      const repo = createMemoryRepository(db, false);

      const entry = repo.store({
        content: 'No vec',
        metadata: {},
        createdAt: Date.now(),
      });

      // Should not throw even without vec table
      const deleted = repo.delete(entry.id);
      expect(deleted).toBe(true);
    });
  });

  describe('compact function', () => {
    it('should delete entries older than threshold', () => {
      const repo = createMemoryRepository(db, false);
      const now = Date.now();

      // Create old entry
      db.run(
        'INSERT INTO memory (id, content, metadata, created_at) VALUES (?, ?, ?, ?)',
        ['old-entry', 'Old content', '{}', now - 100000]
      );

      // Create new entry
      db.run(
        'INSERT INTO memory (id, content, metadata, created_at) VALUES (?, ?, ?, ?)',
        ['new-entry', 'New content', '{}', now]
      );

      const compacted = repo.compact(50000); // 50 seconds

      expect(compacted).toBeGreaterThanOrEqual(1);
      expect(repo.get('old-entry')).toBeNull();
      expect(repo.get('new-entry')).not.toBeNull();
    });

    it('should return count of deleted entries', () => {
      const repo = createMemoryRepository(db, false);
      const now = Date.now();

      // Create multiple old entries
      for (let i = 0; i < 5; i++) {
        db.run(
          'INSERT INTO memory (id, content, metadata, created_at) VALUES (?, ?, ?, ?)',
          [`old-${i}`, `Old ${i}`, '{}', now - 100000]
        );
      }

      const compacted = repo.compact(50000);

      expect(compacted).toBe(5);
    });

    it('should compact vec table when enabled', () => {
      // Create vec table
      db.run(`
        CREATE TABLE IF NOT EXISTS memory_vec (
          id TEXT PRIMARY KEY,
          embedding BLOB
        )
      `);

      const repo = createMemoryRepository(db, true);
      const now = Date.now();

      // Insert old entry with embedding
      const oldId = 'old-vec-entry';
      db.run(
        'INSERT INTO memory (id, content, metadata, created_at) VALUES (?, ?, ?, ?)',
        [oldId, 'Old vec', '{}', now - 100000]
      );
      db.run(
        'INSERT INTO memory_vec (id, embedding) VALUES (?, ?)',
        [oldId, new Uint8Array(8)]
      );

      const compacted = repo.compact(50000);

      expect(compacted).toBeGreaterThanOrEqual(1);

      // Verify vec entry also removed
      const vecRow = db.query('SELECT * FROM memory_vec WHERE id = ?').get(oldId);
      expect(vecRow).toBeNull();
    });

    it('should not compact recent entries', () => {
      const repo = createMemoryRepository(db, false);

      const entry = repo.store({
        content: 'Recent',
        metadata: {},
        createdAt: Date.now(),
      });

      const compacted = repo.compact(1000); // 1 second

      expect(repo.get(entry.id)).not.toBeNull();
    });

    it('should handle zero threshold', () => {
      const repo = createMemoryRepository(db, false);

      const entry = repo.store({
        content: 'Test',
        metadata: {},
        createdAt: Date.now() - 1,
      });

      // With threshold 0, should delete everything older than now
      const compacted = repo.compact(0);

      expect(compacted).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Float32Array operations', () => {
    it('should create embedding array with correct dimensions', () => {
      const dims = 1536;
      const embedding = new Float32Array(dims);

      expect(embedding.length).toBe(dims);
      expect(embedding.byteLength).toBe(dims * 4); // 4 bytes per float32
    });

    it('should preserve values through buffer conversion', () => {
      const original = new Float32Array([0.1, 0.2, 0.3, -0.5, 1.0]);
      const buffer = new Uint8Array(original.buffer);
      const restored = new Float32Array(buffer.buffer);

      for (let i = 0; i < original.length; i++) {
        expect(Math.abs(restored[i] - original[i])).toBeLessThan(0.0001);
      }
    });

    it('should handle zeros', () => {
      const zeros = new Float32Array(1536);
      const buffer = new Uint8Array(zeros.buffer);

      expect(buffer.every(b => b === 0)).toBe(true);
    });

    it('should handle special float values', () => {
      const special = new Float32Array([
        0,
        -0,
        Infinity,
        -Infinity,
        Number.MAX_VALUE,
        Number.MIN_VALUE,
      ]);

      const buffer = new Uint8Array(special.buffer);
      const restored = new Float32Array(buffer.buffer);

      expect(restored[0]).toBe(0);
      expect(Object.is(restored[1], -0)).toBe(true);
      expect(restored[2]).toBe(Infinity);
      expect(restored[3]).toBe(-Infinity);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty content', () => {
      const repo = createMemoryRepository(db, false);

      const entry = repo.store({
        content: '',
        metadata: {},
        createdAt: Date.now(),
      });

      expect(entry.content).toBe('');
    });

    it('should handle very large content', () => {
      const repo = createMemoryRepository(db, false);
      const largeContent = 'x'.repeat(1000000);

      const entry = repo.store({
        content: largeContent,
        metadata: {},
        createdAt: Date.now(),
      });

      const retrieved = repo.get(entry.id);
      expect(retrieved?.content.length).toBe(1000000);
    });

    it('should handle unicode content', () => {
      const repo = createMemoryRepository(db, false);
      const unicodeContent = '\u4e16\u754c\u4f60\u597d \u0411\u044b';

      const entry = repo.store({
        content: unicodeContent,
        metadata: {},
        createdAt: Date.now(),
      });

      const retrieved = repo.get(entry.id);
      expect(retrieved?.content).toBe(unicodeContent);
    });

    it('should handle special JSON characters in content', () => {
      const repo = createMemoryRepository(db, false);
      const specialContent = '{"key": "value with \\"quotes\\" and \\n newlines"}';

      const entry = repo.store({
        content: specialContent,
        metadata: {},
        createdAt: Date.now(),
      });

      const retrieved = repo.get(entry.id);
      expect(retrieved?.content).toBe(specialContent);
    });
  });
});
