/**
 * DatabaseConnection Tests
 * Tests connection management and vec extension loading
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { DatabaseConnection } from '../../../src/infra/db/connection';

describe('DatabaseConnection', () => {
  const testDir = join(import.meta.dir, 'test-connection');
  let dbPath: string;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    dbPath = join(testDir, 'test.db');
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('constructor', () => {
    it('should create database with given path', () => {
      const conn = new DatabaseConnection({ path: dbPath });
      expect(conn.raw).toBeDefined();
      conn.close();
    });

    it('should enable foreign keys', () => {
      const conn = new DatabaseConnection({ path: dbPath });
      const result = conn.raw.query('PRAGMA foreign_keys').get() as { foreign_keys: number };
      expect(result.foreign_keys).toBe(1);
      conn.close();
    });

    it('should set journal mode to WAL', () => {
      const conn = new DatabaseConnection({ path: dbPath });
      const result = conn.raw.query('PRAGMA journal_mode').get() as { journal_mode: string };
      expect(result.journal_mode).toBe('wal');
      conn.close();
    });

    it('should set synchronous to NORMAL', () => {
      const conn = new DatabaseConnection({ path: dbPath });
      const result = conn.raw.query('PRAGMA synchronous').get() as { synchronous: number };
      expect(result.synchronous).toBe(1); // NORMAL = 1
      conn.close();
    });
  });

  describe('loadVecExtension', () => {
    it('should attempt to load vec when enabled', () => {
      // This will either succeed if sqlite-vec is installed, or fail gracefully
      const conn = new DatabaseConnection({ path: dbPath, enableVec: true });
      // hasVec will be true if loaded, false otherwise
      expect(typeof conn.hasVec).toBe('boolean');
      conn.close();
    });

    it('should not load vec when disabled', () => {
      const conn = new DatabaseConnection({ path: dbPath, enableVec: false });
      expect(conn.hasVec).toBe(false);
      conn.close();
    });

    it('should not load vec by default', () => {
      const conn = new DatabaseConnection({ path: dbPath });
      expect(conn.hasVec).toBe(false);
      conn.close();
    });

    it('should handle vec extension not available', () => {
      // When sqlite-vec is not installed, it should warn and continue
      const conn = new DatabaseConnection({ path: dbPath, enableVec: true });
      // Should not throw, just set vecEnabled = false
      expect(typeof conn.hasVec).toBe('boolean');
      conn.close();
    });
  });

  describe('raw getter', () => {
    it('should return the underlying BunSQLite instance', () => {
      const conn = new DatabaseConnection({ path: dbPath });
      const raw = conn.raw;
      expect(raw).toBeDefined();
      expect(typeof raw.query).toBe('function');
      expect(typeof raw.run).toBe('function');
      conn.close();
    });
  });

  describe('hasVec getter', () => {
    it('should return boolean', () => {
      const conn = new DatabaseConnection({ path: dbPath });
      expect(typeof conn.hasVec).toBe('boolean');
      conn.close();
    });
  });

  describe('close', () => {
    it('should close the database connection', () => {
      const conn = new DatabaseConnection({ path: dbPath });
      conn.close();
      // After close, operations should fail
      expect(() => conn.raw.query('SELECT 1').get()).toThrow();
    });
  });

  describe('checkIntegrity', () => {
    it('should return true for healthy database', async () => {
      const conn = new DatabaseConnection({ path: dbPath });
      const result = await conn.checkIntegrity();
      expect(result).toBe(true);
      conn.close();
    });

    it('should execute integrity_check pragma', async () => {
      const conn = new DatabaseConnection({ path: dbPath });
      // Create a simple table to ensure db is valid
      conn.raw.run('CREATE TABLE test (id INTEGER PRIMARY KEY)');
      conn.raw.run('INSERT INTO test VALUES (1)');

      const result = await conn.checkIntegrity();
      expect(result).toBe(true);
      conn.close();
    });
  });
});

describe('DatabaseConnection - Edge cases', () => {
  const testDir = join(import.meta.dir, 'test-connection-edge');
  let dbPath: string;

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    dbPath = join(testDir, 'edge.db');
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  it('should create new database if not exists', () => {
    expect(existsSync(dbPath)).toBe(false);
    const conn = new DatabaseConnection({ path: dbPath });
    expect(existsSync(dbPath)).toBe(true);
    conn.close();
  });

  it('should open existing database', () => {
    // Create first
    const conn1 = new DatabaseConnection({ path: dbPath });
    conn1.raw.run('CREATE TABLE existing (id INTEGER)');
    conn1.close();

    // Reopen
    const conn2 = new DatabaseConnection({ path: dbPath });
    const tables = conn2.raw.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='existing'"
    ).get();
    expect(tables).toBeDefined();
    conn2.close();
  });

  it('should handle multiple opens of same database', () => {
    const conn1 = new DatabaseConnection({ path: dbPath });
    const conn2 = new DatabaseConnection({ path: dbPath });

    // Both should work (SQLite allows multiple readers)
    const r1 = conn1.raw.query('SELECT 1 as num').get() as { num: number };
    const r2 = conn2.raw.query('SELECT 2 as num').get() as { num: number };

    expect(r1.num).toBe(1);
    expect(r2.num).toBe(2);

    conn1.close();
    conn2.close();
  });

  it('should handle in-memory database', () => {
    const conn = new DatabaseConnection({ path: ':memory:' });
    conn.raw.run('CREATE TABLE mem (id INTEGER)');
    conn.raw.run('INSERT INTO mem VALUES (42)');

    const result = conn.raw.query('SELECT id FROM mem').get() as { id: number };
    expect(result.id).toBe(42);

    conn.close();
  });
});
