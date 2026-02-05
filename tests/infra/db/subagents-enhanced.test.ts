/**
 * Subagents Repository Enhanced Tests
 * Tests edge cases for subagent operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';
import { Database } from '../../../src/infra/database';

describe('Subagents Repository Enhanced', () => {
  let db: Database;
  const testDbPath = join(import.meta.dir, 'test-subagents-enhanced.sqlite');

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

  describe('create', () => {
    it('should create subagent with minimal data', () => {
      const record = db.subagents.create({
        agentName: 'test-agent',
        parentId: null,
        taskDescription: 'Test task',
        status: 'running',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      expect(record.id).toBeDefined();
      expect(record.agentName).toBe('test-agent');
      expect(record.status).toBe('running');
    });

    it('should create subagent with parent', () => {
      const parent = db.subagents.create({
        agentName: 'parent-agent',
        parentId: null,
        taskDescription: 'Parent task',
        status: 'running',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      const child = db.subagents.create({
        agentName: 'child-agent',
        parentId: parent.id,
        taskDescription: 'Child task',
        status: 'running',
        spawnedAt: Date.now(),
        timeoutMs: 30000,
      });

      expect(child.parentId).toBe(parent.id);
    });

    it('should create subagent with PID', () => {
      const record = db.subagents.create({
        agentName: 'test-agent',
        parentId: null,
        taskDescription: 'Test task',
        pid: 12345,
        status: 'running',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      expect(record.pid).toBe(12345);
    });

    it('should create subagent with all optional fields', () => {
      const record = db.subagents.create({
        agentName: 'full-agent',
        parentId: null,
        taskDescription: 'Full task',
        pid: 99999,
        status: 'running',
        spawnedAt: Date.now(),
        timeoutMs: 120000,
        result: 'Initial result',
        tokensUsed: 1000,
        toolUses: 5,
      });

      expect(record.result).toBe('Initial result');
      expect(record.tokensUsed).toBe(1000);
      expect(record.toolUses).toBe(5);
    });
  });

  describe('get', () => {
    it('should get subagent by id', () => {
      const created = db.subagents.create({
        agentName: 'test-agent',
        parentId: null,
        taskDescription: 'Test task',
        status: 'running',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      const retrieved = db.subagents.get(created.id);
      expect(retrieved?.id).toBe(created.id);
    });

    it('should return null for non-existent id', () => {
      const result = db.subagents.get('nonexistent-id');
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update status', () => {
      const record = db.subagents.create({
        agentName: 'test-agent',
        parentId: null,
        taskDescription: 'Test task',
        status: 'running',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      const updated = db.subagents.update(record.id, { status: 'completed' });
      expect(updated.status).toBe('completed');
    });

    it('should update completedAt', () => {
      const record = db.subagents.create({
        agentName: 'test-agent',
        parentId: null,
        taskDescription: 'Test task',
        status: 'running',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      const completedAt = Date.now();
      const updated = db.subagents.update(record.id, {
        status: 'completed',
        completedAt,
      });

      expect(updated.completedAt).toBe(completedAt);
    });

    it('should update result', () => {
      const record = db.subagents.create({
        agentName: 'test-agent',
        parentId: null,
        taskDescription: 'Test task',
        status: 'running',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      const updated = db.subagents.update(record.id, {
        result: 'Task completed successfully',
      });

      expect(updated.result).toBe('Task completed successfully');
    });

    it('should update token and tool usage', () => {
      const record = db.subagents.create({
        agentName: 'test-agent',
        parentId: null,
        taskDescription: 'Test task',
        status: 'running',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      const updated = db.subagents.update(record.id, {
        tokensUsed: 5000,
        toolUses: 25,
      });

      expect(updated.tokensUsed).toBe(5000);
      expect(updated.toolUses).toBe(25);
    });

    it('should update multiple fields at once', () => {
      const record = db.subagents.create({
        agentName: 'test-agent',
        parentId: null,
        taskDescription: 'Test task',
        status: 'running',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      const updated = db.subagents.update(record.id, {
        status: 'completed',
        completedAt: Date.now(),
        result: 'Done',
        tokensUsed: 2000,
        toolUses: 10,
      });

      expect(updated.status).toBe('completed');
      expect(updated.result).toBe('Done');
    });
  });

  describe('list', () => {
    it('should list all subagents', () => {
      db.subagents.create({
        agentName: 'agent-1',
        parentId: null,
        taskDescription: 'Task 1',
        status: 'running',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      db.subagents.create({
        agentName: 'agent-2',
        parentId: null,
        taskDescription: 'Task 2',
        status: 'completed',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      const all = db.subagents.list();
      expect(all.length).toBe(2);
    });

    it('should filter by status', () => {
      db.subagents.create({
        agentName: 'running-agent',
        parentId: null,
        taskDescription: 'Running task',
        status: 'running',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      db.subagents.create({
        agentName: 'completed-agent',
        parentId: null,
        taskDescription: 'Completed task',
        status: 'completed',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      const running = db.subagents.list({ status: 'running' });
      expect(running.length).toBe(1);
      expect(running[0]?.agentName).toBe('running-agent');
    });

    it('should filter by parentId', () => {
      const parent = db.subagents.create({
        agentName: 'parent',
        parentId: null,
        taskDescription: 'Parent task',
        status: 'running',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      db.subagents.create({
        agentName: 'child-1',
        parentId: parent.id,
        taskDescription: 'Child 1',
        status: 'running',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      db.subagents.create({
        agentName: 'child-2',
        parentId: parent.id,
        taskDescription: 'Child 2',
        status: 'running',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      db.subagents.create({
        agentName: 'orphan',
        parentId: null,
        taskDescription: 'Orphan task',
        status: 'running',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      const children = db.subagents.list({ parentId: parent.id });
      expect(children.length).toBe(2);
    });

    it('should return empty array when no matches', () => {
      const results = db.subagents.list({ status: 'failed' });
      expect(results).toEqual([]);
    });
  });

  describe('getRunning', () => {
    it('should get only running subagents', () => {
      db.subagents.create({
        agentName: 'running-1',
        parentId: null,
        taskDescription: 'Running 1',
        status: 'running',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      db.subagents.create({
        agentName: 'running-2',
        parentId: null,
        taskDescription: 'Running 2',
        status: 'running',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      db.subagents.create({
        agentName: 'completed',
        parentId: null,
        taskDescription: 'Completed',
        status: 'completed',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      db.subagents.create({
        agentName: 'failed',
        parentId: null,
        taskDescription: 'Failed',
        status: 'failed',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      const running = db.subagents.getRunning();
      expect(running.length).toBe(2);
      expect(running.every(r => r.status === 'running')).toBe(true);
    });

    it('should return empty when no running subagents', () => {
      db.subagents.create({
        agentName: 'completed',
        parentId: null,
        taskDescription: 'Completed',
        status: 'completed',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      const running = db.subagents.getRunning();
      expect(running).toEqual([]);
    });
  });

  describe('markOrphaned', () => {
    it('should mark old running subagents as orphaned', () => {
      const oldTime = Date.now() - 200000;

      const oldAgent = db.subagents.create({
        agentName: 'old-agent',
        parentId: null,
        taskDescription: 'Old task',
        status: 'running',
        spawnedAt: oldTime,
        timeoutMs: 60000,
      });

      db.subagents.create({
        agentName: 'new-agent',
        parentId: null,
        taskDescription: 'New task',
        status: 'running',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      // Mark agents older than 100000ms (100 seconds)
      const count = db.subagents.markOrphaned(100000);

      expect(count).toBeGreaterThanOrEqual(1);

      const oldRetrieved = db.subagents.get(oldAgent.id);
      expect(oldRetrieved?.status).toBe('orphaned');
    });

    it('should not affect completed subagents', () => {
      const oldTime = Date.now() - 200000;

      const completed = db.subagents.create({
        agentName: 'completed-agent',
        parentId: null,
        taskDescription: 'Completed task',
        status: 'completed',
        spawnedAt: oldTime,
        timeoutMs: 60000,
      });

      db.subagents.markOrphaned(100000);

      const retrieved = db.subagents.get(completed.id);
      expect(retrieved?.status).toBe('completed');
    });

    it('should return count of marked subagents', () => {
      const oldTime = Date.now() - 200000;

      db.subagents.create({
        agentName: 'old-1',
        parentId: null,
        taskDescription: 'Old 1',
        status: 'running',
        spawnedAt: oldTime,
        timeoutMs: 60000,
      });

      db.subagents.create({
        agentName: 'old-2',
        parentId: null,
        taskDescription: 'Old 2',
        status: 'running',
        spawnedAt: oldTime,
        timeoutMs: 60000,
      });

      const count = db.subagents.markOrphaned(100000);
      expect(count).toBe(2);
    });
  });

  describe('Status Values', () => {
    it('should accept status "running"', () => {
      const record = db.subagents.create({
        agentName: 'test',
        parentId: null,
        taskDescription: 'Test',
        status: 'running',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      expect(record.status).toBe('running');
    });

    it('should accept status "completed"', () => {
      const record = db.subagents.create({
        agentName: 'test',
        parentId: null,
        taskDescription: 'Test',
        status: 'completed',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      expect(record.status).toBe('completed');
    });

    it('should accept status "failed"', () => {
      const record = db.subagents.create({
        agentName: 'test',
        parentId: null,
        taskDescription: 'Test',
        status: 'failed',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      expect(record.status).toBe('failed');
    });

    it('should accept status "timeout"', () => {
      const record = db.subagents.create({
        agentName: 'test',
        parentId: null,
        taskDescription: 'Test',
        status: 'timeout',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      expect(record.status).toBe('timeout');
    });

    it('should accept status "orphaned"', () => {
      const record = db.subagents.create({
        agentName: 'test',
        parentId: null,
        taskDescription: 'Test',
        status: 'orphaned',
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      });

      expect(record.status).toBe('orphaned');
    });
  });
});
