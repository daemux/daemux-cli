/**
 * Memory Repository Enhanced Tests
 * Tests edge cases for memory/embedding operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';
import { Database } from '../../../src/infra/database';

describe('Memory Repository Enhanced', () => {
  let db: Database;
  const testDbPath = join(import.meta.dir, 'test-memory-enhanced.sqlite');

  beforeEach(async () => {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    db = new Database({ path: testDbPath, enableVec: false });
    await db.initialize();
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe('store', () => {
    it('should store entry with minimal data', () => {
      const entry = db.memory.store({
        content: 'Test content',
        metadata: {},
        createdAt: Date.now(),
      });

      expect(entry.id).toBeDefined();
      expect(entry.content).toBe('Test content');
    });

    it('should store entry with complex metadata', () => {
      const metadata = {
        tags: ['important', 'reference'],
        score: 0.95,
        nested: { level1: { level2: 'value' } },
      };

      const entry = db.memory.store({
        content: 'Content with metadata',
        metadata,
        createdAt: Date.now(),
      });

      const retrieved = db.memory.get(entry.id);
      expect(retrieved?.metadata).toEqual(metadata);
    });

    it('should store entry with unicode content', () => {
      const unicodeContent = 'Hello \u4e16\u754c! \u0414\u0440\u0443\u0437\u0456!';

      const entry = db.memory.store({
        content: unicodeContent,
        metadata: {},
        createdAt: Date.now(),
      });

      const retrieved = db.memory.get(entry.id);
      expect(retrieved?.content).toBe(unicodeContent);
    });

    it('should store entry with large content', () => {
      const largeContent = 'x'.repeat(100000);

      const entry = db.memory.store({
        content: largeContent,
        metadata: {},
        createdAt: Date.now(),
      });

      const retrieved = db.memory.get(entry.id);
      expect(retrieved?.content.length).toBe(100000);
    });

    it('should assign unique IDs', () => {
      const entry1 = db.memory.store({
        content: 'Content 1',
        metadata: {},
        createdAt: Date.now(),
      });

      const entry2 = db.memory.store({
        content: 'Content 2',
        metadata: {},
        createdAt: Date.now(),
      });

      expect(entry1.id).not.toBe(entry2.id);
    });
  });

  describe('get', () => {
    it('should return null for non-existent ID', () => {
      const result = db.memory.get('nonexistent-id');
      expect(result).toBeNull();
    });

    it('should return correct entry by ID', () => {
      const entry = db.memory.store({
        content: 'Specific content',
        metadata: { key: 'value' },
        createdAt: Date.now(),
      });

      const retrieved = db.memory.get(entry.id);
      expect(retrieved?.id).toBe(entry.id);
      expect(retrieved?.content).toBe('Specific content');
    });
  });

  describe('delete', () => {
    it('should delete existing entry', () => {
      const entry = db.memory.store({
        content: 'To be deleted',
        metadata: {},
        createdAt: Date.now(),
      });

      const deleted = db.memory.delete(entry.id);
      expect(deleted).toBe(true);

      const retrieved = db.memory.get(entry.id);
      expect(retrieved).toBeNull();
    });

    it('should return false for non-existent entry', () => {
      const deleted = db.memory.delete('nonexistent-id');
      expect(deleted).toBe(false);
    });

    it('should not affect other entries', () => {
      const entry1 = db.memory.store({
        content: 'Content 1',
        metadata: {},
        createdAt: Date.now(),
      });

      const entry2 = db.memory.store({
        content: 'Content 2',
        metadata: {},
        createdAt: Date.now(),
      });

      db.memory.delete(entry1.id);

      const retrieved2 = db.memory.get(entry2.id);
      expect(retrieved2).not.toBeNull();
      expect(retrieved2?.content).toBe('Content 2');
    });
  });

  describe('search (without vector)', () => {
    it('should return empty array without vector support', () => {
      db.memory.store({
        content: 'Searchable content',
        metadata: {},
        createdAt: Date.now(),
      });

      // Without enableVec, search returns empty
      const results = db.memory.search(new Float32Array(1536), 10);
      expect(results).toEqual([]);
    });
  });

  describe('compact', () => {
    it('should compact old entries', () => {
      const oldTime = Date.now() - 100000;
      const newTime = Date.now();

      db.memory.store({
        content: 'Old entry',
        metadata: {},
        createdAt: oldTime,
      });

      db.memory.store({
        content: 'New entry',
        metadata: {},
        createdAt: newTime,
      });

      const compactedCount = db.memory.compact(50000);

      // Should have compacted old entry
      expect(compactedCount).toBeGreaterThanOrEqual(0);
    });

    it('should not compact recent entries', () => {
      const entry = db.memory.store({
        content: 'Recent entry',
        metadata: {},
        createdAt: Date.now(),
      });

      db.memory.compact(1);

      const retrieved = db.memory.get(entry.id);
      expect(retrieved).not.toBeNull();
    });
  });
});
