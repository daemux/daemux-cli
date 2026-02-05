/**
 * Database Unit Tests
 * Tests CRUD operations for all database repositories
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from '../src/infra/database';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';

describe('Database', () => {
  let db: Database;
  const testDbPath = join(import.meta.dir, 'test-db.sqlite');

  beforeEach(async () => {
    // Clean up any existing test database
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

  describe('Database Integrity', () => {
    it('should pass integrity check', async () => {
      const result = await db.checkIntegrity();
      expect(result).toBe(true);
    });
  });

  describe('Sessions Repository', () => {
    it('should create a session', () => {
      const session = db.sessions.create({
        createdAt: Date.now(),
        lastActivity: Date.now(),
        compactionCount: 0,
        totalTokensUsed: 0,
        queueMode: 'steer',
        flags: {},
      });

      expect(session.id).toBeDefined();
      expect(session.queueMode).toBe('steer');
    });

    it('should get a session by id', () => {
      const created = db.sessions.create({
        createdAt: Date.now(),
        lastActivity: Date.now(),
        compactionCount: 0,
        totalTokensUsed: 0,
        queueMode: 'queue',
        flags: { test: true },
      });

      const retrieved = db.sessions.get(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.queueMode).toBe('queue');
      expect(retrieved?.flags).toEqual({ test: true });
    });

    it('should update a session', () => {
      const created = db.sessions.create({
        createdAt: Date.now(),
        lastActivity: Date.now(),
        compactionCount: 0,
        totalTokensUsed: 0,
        queueMode: 'steer',
        flags: {},
      });

      const updated = db.sessions.update(created.id, {
        compactionCount: 5,
        totalTokensUsed: 1000,
      });

      expect(updated.compactionCount).toBe(5);
      expect(updated.totalTokensUsed).toBe(1000);
    });

    it('should list sessions', () => {
      db.sessions.create({
        createdAt: Date.now(),
        lastActivity: Date.now(),
        compactionCount: 0,
        totalTokensUsed: 0,
        queueMode: 'steer',
        flags: {},
      });
      db.sessions.create({
        createdAt: Date.now(),
        lastActivity: Date.now(),
        compactionCount: 0,
        totalTokensUsed: 0,
        queueMode: 'queue',
        flags: {},
      });

      const sessions = db.sessions.list();
      expect(sessions.length).toBe(2);
    });

    it('should delete a session', () => {
      const created = db.sessions.create({
        createdAt: Date.now(),
        lastActivity: Date.now(),
        compactionCount: 0,
        totalTokensUsed: 0,
        queueMode: 'steer',
        flags: {},
      });

      const deleted = db.sessions.delete(created.id);
      expect(deleted).toBe(true);

      const retrieved = db.sessions.get(created.id);
      expect(retrieved).toBeNull();
    });

    it('should get active session', () => {
      const session1 = db.sessions.create({
        createdAt: Date.now() - 10000,
        lastActivity: Date.now() - 10000,
        compactionCount: 0,
        totalTokensUsed: 0,
        queueMode: 'steer',
        flags: {},
      });
      const session2 = db.sessions.create({
        createdAt: Date.now(),
        lastActivity: Date.now(),
        compactionCount: 0,
        totalTokensUsed: 0,
        queueMode: 'queue',
        flags: {},
      });

      const active = db.sessions.getActive();
      expect(active?.id).toBe(session2.id);
    });
  });

  describe('Messages Repository', () => {
    let sessionId: string;

    beforeEach(() => {
      const session = db.sessions.create({
        createdAt: Date.now(),
        lastActivity: Date.now(),
        compactionCount: 0,
        totalTokensUsed: 0,
        queueMode: 'steer',
        flags: {},
      });
      sessionId = session.id;
    });

    it('should create a message', () => {
      const message = db.messages.create(sessionId, {
        parentUuid: null,
        role: 'user',
        content: 'Hello, world!',
        createdAt: Date.now(),
      });

      expect(message.uuid).toBeDefined();
      expect(message.role).toBe('user');
      expect(message.content).toBe('Hello, world!');
    });

    it('should handle JSON content', () => {
      const contentBlocks = [
        { type: 'text', text: 'Hello' },
        { type: 'tool_use', id: '123', name: 'test', input: {} },
      ];

      const message = db.messages.create(sessionId, {
        parentUuid: null,
        role: 'assistant',
        content: contentBlocks,
        createdAt: Date.now(),
      });

      const retrieved = db.messages.get(message.uuid);
      expect(retrieved?.content).toEqual(contentBlocks);
    });

    it('should list messages for a session', () => {
      db.messages.create(sessionId, {
        parentUuid: null,
        role: 'user',
        content: 'First',
        createdAt: Date.now(),
      });
      db.messages.create(sessionId, {
        parentUuid: null,
        role: 'assistant',
        content: 'Second',
        createdAt: Date.now() + 1,
      });

      const messages = db.messages.list(sessionId);
      expect(messages.length).toBe(2);
    });

    it('should delete a message', () => {
      const message = db.messages.create(sessionId, {
        parentUuid: null,
        role: 'user',
        content: 'To delete',
        createdAt: Date.now(),
      });

      const deleted = db.messages.delete(message.uuid);
      expect(deleted).toBe(true);

      const retrieved = db.messages.get(message.uuid);
      expect(retrieved).toBeNull();
    });

    it('should validate message chain', () => {
      db.messages.create(sessionId, {
        parentUuid: null,
        role: 'user',
        content: 'Hello',
        createdAt: Date.now(),
      });

      const validation = db.messages.validateChain(sessionId);
      expect(validation.valid).toBe(true);
    });

    it('should get token count', () => {
      db.messages.create(sessionId, {
        parentUuid: null,
        role: 'user',
        content: 'Hello',
        createdAt: Date.now(),
        tokenCount: 100,
      });
      db.messages.create(sessionId, {
        parentUuid: null,
        role: 'assistant',
        content: 'Hi there!',
        createdAt: Date.now() + 1,
        tokenCount: 50,
      });

      const count = db.messages.getTokenCount(sessionId);
      expect(count).toBe(150);
    });
  });

  describe('Tasks Repository', () => {
    it('should create a task', () => {
      const task = db.tasks.create({
        subject: 'Test task',
        description: 'A test task description',
        status: 'pending',
        blockedBy: [],
        blocks: [],
        metadata: {},
      });

      expect(task.id).toBeDefined();
      expect(task.subject).toBe('Test task');
      expect(task.status).toBe('pending');
    });

    it('should get a task by id', () => {
      const created = db.tasks.create({
        subject: 'Test task',
        description: 'Description',
        status: 'pending',
        blockedBy: [],
        blocks: [],
        metadata: { priority: 'high' },
      });

      const retrieved = db.tasks.get(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.metadata).toEqual({ priority: 'high' });
    });

    it('should update a task', () => {
      const created = db.tasks.create({
        subject: 'Test task',
        description: 'Description',
        status: 'pending',
        blockedBy: [],
        blocks: [],
        metadata: {},
      });

      const updated = db.tasks.update(created.id, {
        status: 'in_progress',
        owner: 'agent-1',
      });

      expect(updated.status).toBe('in_progress');
      expect(updated.owner).toBe('agent-1');
    });

    it('should list tasks with filters', () => {
      db.tasks.create({
        subject: 'Pending task',
        description: 'Description',
        status: 'pending',
        blockedBy: [],
        blocks: [],
        metadata: {},
      });
      db.tasks.create({
        subject: 'In progress task',
        description: 'Description',
        status: 'in_progress',
        owner: 'agent-1',
        blockedBy: [],
        blocks: [],
        metadata: {},
      });

      const pendingTasks = db.tasks.list({ status: 'pending' });
      expect(pendingTasks.length).toBe(1);
      expect(pendingTasks[0].subject).toBe('Pending task');

      const agentTasks = db.tasks.list({ owner: 'agent-1' });
      expect(agentTasks.length).toBe(1);
    });

    it('should soft delete a task', () => {
      const created = db.tasks.create({
        subject: 'Test task',
        description: 'Description',
        status: 'pending',
        blockedBy: [],
        blocks: [],
        metadata: {},
      });

      const deleted = db.tasks.delete(created.id);
      expect(deleted).toBe(true);

      const retrieved = db.tasks.get(created.id);
      expect(retrieved?.status).toBe('deleted');
    });

    it('should handle task dependencies', () => {
      const blocker = db.tasks.create({
        subject: 'Blocker task',
        description: 'Must complete first',
        status: 'pending',
        blockedBy: [],
        blocks: [],
        metadata: {},
      });

      const blocked = db.tasks.create({
        subject: 'Blocked task',
        description: 'Depends on blocker',
        status: 'pending',
        blockedBy: [blocker.id],
        blocks: [],
        metadata: {},
      });

      db.tasks.addDependency(blocked.id, blocker.id);

      const blockedTasks = db.tasks.getBlocked();
      expect(blockedTasks.length).toBeGreaterThanOrEqual(1);
    });

    it('should list not blocked tasks', () => {
      db.tasks.create({
        subject: 'Free task',
        description: 'No blockers',
        status: 'pending',
        blockedBy: [],
        blocks: [],
        metadata: {},
      });

      const blocker = db.tasks.create({
        subject: 'Blocker',
        description: 'A blocker',
        status: 'pending',
        blockedBy: [],
        blocks: [],
        metadata: {},
      });

      db.tasks.create({
        subject: 'Blocked task',
        description: 'Has a blocker',
        status: 'pending',
        blockedBy: [blocker.id],
        blocks: [],
        metadata: {},
      });

      const freeTasks = db.tasks.list({ notBlocked: true });
      expect(freeTasks.length).toBe(2); // Free task and Blocker
    });
  });

  describe('State Repository', () => {
    it('should set and get state', () => {
      db.state.set('testKey', { value: 123 });
      const retrieved = db.state.get('testKey');
      expect(retrieved).toEqual({ value: 123 });
    });

    it('should return undefined for non-existent key', () => {
      const retrieved = db.state.get('nonExistent');
      expect(retrieved).toBeUndefined();
    });

    it('should delete state', () => {
      db.state.set('toDelete', { data: 'test' });
      const deleted = db.state.delete('toDelete');
      expect(deleted).toBe(true);

      const retrieved = db.state.get('toDelete');
      expect(retrieved).toBeUndefined();
    });

    it('should list state entries', () => {
      db.state.set('prefix:key1', 'value1');
      db.state.set('prefix:key2', 'value2');
      db.state.set('other:key3', 'value3');

      const entries = db.state.list('prefix:');
      expect(entries.length).toBe(2);
      expect(entries.map(e => e.key)).toContain('prefix:key1');
      expect(entries.map(e => e.key)).toContain('prefix:key2');
    });
  });

  describe('Audit Repository', () => {
    it('should log an audit entry', () => {
      // audit.log returns void, so we just verify it doesn't throw
      expect(() => {
        db.audit.log({
          action: 'test_action',
          target: 'test_target',
          result: 'success',
          details: { info: 'test' },
        });
      }).not.toThrow();

      // Verify entry was created by querying
      const entries = db.audit.query({ action: 'test_action' });
      expect(entries.length).toBe(1);
      expect(entries[0].action).toBe('test_action');
    });

    it('should query audit entries', () => {
      db.audit.log({
        action: 'action1',
        result: 'success',
      });
      db.audit.log({
        action: 'action2',
        result: 'failure',
      });

      const entries = db.audit.query({});
      expect(entries.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter audit entries by action', () => {
      db.audit.log({
        action: 'login',
        result: 'success',
      });
      db.audit.log({
        action: 'logout',
        result: 'success',
      });

      const loginEntries = db.audit.query({ action: 'login' });
      expect(loginEntries.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Memory Repository', () => {
    it('should store a memory entry', () => {
      const entry = db.memory.store({
        content: 'Important information',
        metadata: { topic: 'test' },
        createdAt: Date.now(),
      });

      expect(entry.id).toBeDefined();
      expect(entry.content).toBe('Important information');
    });

    it('should get a memory entry', () => {
      const created = db.memory.store({
        content: 'Test content',
        metadata: {},
        createdAt: Date.now(),
      });

      const retrieved = db.memory.get(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.content).toBe('Test content');
    });

    it('should delete a memory entry', () => {
      const created = db.memory.store({
        content: 'To delete',
        metadata: {},
        createdAt: Date.now(),
      });

      const deleted = db.memory.delete(created.id);
      expect(deleted).toBe(true);

      const retrieved = db.memory.get(created.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('Subagents Repository', () => {
    it('should create a subagent record', () => {
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

    it('should update subagent status', () => {
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
        result: 'Success!',
      });

      expect(updated.status).toBe('completed');
      expect(updated.result).toBe('Success!');
    });

    it('should get running subagents', () => {
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

      const running = db.subagents.getRunning();
      expect(running.length).toBe(1);
      expect(running[0].agentName).toBe('agent-1');
    });
  });

  describe('Approvals Repository', () => {
    it('should create an approval request', () => {
      const request = db.approvals.create({
        command: 'rm -rf /tmp/test',
        context: { reason: 'cleanup' },
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 60000,
        decision: null,
      });

      expect(request.id).toBeDefined();
      expect(request.command).toBe('rm -rf /tmp/test');
      expect(request.decision).toBeNull();
    });

    it('should update an approval decision', () => {
      const request = db.approvals.create({
        command: 'test command',
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 60000,
        decision: null,
      });

      const decided = db.approvals.update(request.id, {
        decision: 'allow-once',
        decidedAtMs: Date.now(),
        decidedBy: 'user-1',
      });
      expect(decided.decision).toBe('allow-once');
      expect(decided.decidedBy).toBe('user-1');
    });

    it('should get pending approvals', () => {
      db.approvals.create({
        command: 'pending command',
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 60000,
        decision: null,
      });
      db.approvals.create({
        command: 'decided command',
        createdAtMs: Date.now(),
        expiresAtMs: Date.now() + 60000,
        decision: 'allow-once',
      });

      const pending = db.approvals.getPending();
      expect(pending.length).toBe(1);
      expect(pending[0].command).toBe('pending command');
    });
  });

  describe('Schedules Repository', () => {
    it('should create a schedule', () => {
      const schedule = db.schedules.create({
        type: 'every',
        expression: '1h',
        timezone: 'UTC',
        taskTemplate: { subject: 'Hourly task', description: 'Runs every hour' },
        nextRunMs: Date.now() + 3600000,
        enabled: true,
      });

      expect(schedule.id).toBeDefined();
      expect(schedule.type).toBe('every');
    });

    it('should get due schedules', () => {
      const pastSchedule = db.schedules.create({
        type: 'at',
        expression: 'test',
        taskTemplate: { subject: 'Past', description: 'Due' },
        nextRunMs: Date.now() - 1000,
        enabled: true,
      });

      const futureSchedule = db.schedules.create({
        type: 'at',
        expression: 'test',
        taskTemplate: { subject: 'Future', description: 'Not due' },
        nextRunMs: Date.now() + 100000,
        enabled: true,
      });

      const due = db.schedules.getDue();
      expect(due.length).toBe(1);
      expect(due[0].id).toBe(pastSchedule.id);
    });

    it('should toggle schedule enabled status', () => {
      const schedule = db.schedules.create({
        type: 'cron',
        expression: '0 * * * *',
        taskTemplate: { subject: 'Test', description: 'Test' },
        nextRunMs: Date.now(),
        enabled: true,
      });

      const updated = db.schedules.update(schedule.id, { enabled: false });
      expect(updated.enabled).toBe(false);
    });
  });
});
