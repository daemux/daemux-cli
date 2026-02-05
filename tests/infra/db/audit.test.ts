/**
 * Audit Repository Tests
 * Tests audit logging and query functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createAuditRepository } from '../../../src/infra/db/audit';

describe('Audit Repository', () => {
  let db: Database;
  let repo: ReturnType<typeof createAuditRepository>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.run(`
      CREATE TABLE audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        user_id TEXT,
        agent_id TEXT,
        result TEXT NOT NULL,
        details TEXT
      )
    `);
    repo = createAuditRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('log', () => {
    it('should insert audit entry with all fields', () => {
      repo.log({
        action: 'test_action',
        target: 'test_target',
        userId: 'user-123',
        agentId: 'agent-456',
        result: 'success',
        details: { key: 'value' },
      });

      const row = db.query('SELECT * FROM audit').get() as any;
      expect(row).toBeDefined();
      expect(row.action).toBe('test_action');
      expect(row.target).toBe('test_target');
      expect(row.user_id).toBe('user-123');
      expect(row.agent_id).toBe('agent-456');
      expect(row.result).toBe('success');
      expect(JSON.parse(row.details)).toEqual({ key: 'value' });
    });

    it('should insert audit entry with minimal fields', () => {
      repo.log({
        action: 'minimal',
        result: 'success',
      });

      const row = db.query('SELECT * FROM audit').get() as any;
      expect(row.action).toBe('minimal');
      expect(row.target).toBeNull();
      expect(row.user_id).toBeNull();
      expect(row.agent_id).toBeNull();
      expect(row.details).toBeNull();
    });

    it('should set timestamp automatically', () => {
      const before = Date.now();
      repo.log({ action: 'timed', result: 'success' });
      const after = Date.now();

      const row = db.query('SELECT * FROM audit').get() as any;
      expect(row.timestamp).toBeGreaterThanOrEqual(before);
      expect(row.timestamp).toBeLessThanOrEqual(after);
    });

    it('should handle different result types', () => {
      repo.log({ action: 'a1', result: 'success' });
      repo.log({ action: 'a2', result: 'failure' });
      repo.log({ action: 'a3', result: 'pending' });

      const rows = db.query('SELECT result FROM audit ORDER BY id').all() as any[];
      expect(rows.map(r => r.result)).toEqual(['success', 'failure', 'pending']);
    });
  });

  describe('query', () => {
    beforeEach(() => {
      // Insert test data
      const entries = [
        { action: 'login', userId: 'user-1', agentId: 'agent-1', result: 'success', ts: 1000 },
        { action: 'login', userId: 'user-2', agentId: 'agent-2', result: 'failure', ts: 2000 },
        { action: 'logout', userId: 'user-1', agentId: 'agent-1', result: 'success', ts: 3000 },
        { action: 'task', userId: 'user-3', agentId: 'agent-3', result: 'success', ts: 4000 },
      ];

      for (const e of entries) {
        db.run(
          'INSERT INTO audit (timestamp, action, user_id, agent_id, result) VALUES (?, ?, ?, ?, ?)',
          [e.ts, e.action, e.userId, e.agentId, e.result]
        );
      }
    });

    it('should query all entries without filter', () => {
      const results = repo.query({});
      expect(results.length).toBe(4);
    });

    it('should filter by action', () => {
      const results = repo.query({ action: 'login' });
      expect(results.length).toBe(2);
      expect(results.every(r => r.action === 'login')).toBe(true);
    });

    it('should filter by userId', () => {
      const results = repo.query({ userId: 'user-1' });
      expect(results.length).toBe(2);
      expect(results.every(r => r.userId === 'user-1')).toBe(true);
    });

    it('should filter by agentId', () => {
      const results = repo.query({ agentId: 'agent-2' });
      expect(results.length).toBe(1);
      expect(results[0].agentId).toBe('agent-2');
    });

    it('should filter by fromMs', () => {
      const results = repo.query({ fromMs: 2500 });
      expect(results.length).toBe(2);
      expect(results.every(r => r.timestamp >= 2500)).toBe(true);
    });

    it('should filter by toMs', () => {
      const results = repo.query({ toMs: 2500 });
      expect(results.length).toBe(2);
      expect(results.every(r => r.timestamp <= 2500)).toBe(true);
    });

    it('should filter by fromMs and toMs range', () => {
      const results = repo.query({ fromMs: 1500, toMs: 3500 });
      expect(results.length).toBe(2);
      expect(results.every(r => r.timestamp >= 1500 && r.timestamp <= 3500)).toBe(true);
    });

    it('should limit results', () => {
      const results = repo.query({ limit: 2 });
      expect(results.length).toBe(2);
    });

    it('should order by timestamp descending', () => {
      const results = repo.query({});
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].timestamp).toBeGreaterThanOrEqual(results[i].timestamp);
      }
    });

    it('should combine multiple filters', () => {
      const results = repo.query({
        action: 'login',
        userId: 'user-1',
      });
      expect(results.length).toBe(1);
      expect(results[0].action).toBe('login');
      expect(results[0].userId).toBe('user-1');
    });

    it('should parse details JSON', () => {
      db.run(
        'INSERT INTO audit (timestamp, action, result, details) VALUES (?, ?, ?, ?)',
        [5000, 'with_details', 'success', JSON.stringify({ foo: 'bar' })]
      );

      const results = repo.query({ action: 'with_details' });
      expect(results[0].details).toEqual({ foo: 'bar' });
    });

    it('should handle null target', () => {
      const results = repo.query({ action: 'login' });
      expect(results[0].target).toBeUndefined();
    });

    it('should default limit to 100', () => {
      // Insert many entries
      for (let i = 0; i < 150; i++) {
        db.run(
          'INSERT INTO audit (timestamp, action, result) VALUES (?, ?, ?)',
          [i, `action_${i}`, 'success']
        );
      }

      const results = repo.query({});
      expect(results.length).toBe(100);
    });
  });
});
