/**
 * Per-Task Time Budget Tests
 * Verifies timeBudgetMs and verifyCommand flow through the system:
 * - Task creation stores fields correctly
 * - DB migration V3 adds new columns
 * - BackgroundTaskRunner passes timeBudgetMs to AgenticLoop
 * - delegate_task tool accepts timeBudgetMs parameter
 * - Falls back to default timeout when not specified
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { existsSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { TaskManager } from '../../src/core/task-manager';
import { Database } from '../../src/infra/database';
import { EventBus } from '../../src/core/event-bus';
import { BackgroundTaskRunner } from '../../src/core/background-task-runner';
import type { SpawnResult } from '../../src/core/background-task-runner';
import { DIALOG_TOOLS, createDialogToolExecutors } from '../../src/core/dialog-tools';
import { createReadyMockProvider } from '../mocks/mock-llm-provider';
import type { Config } from '../../src/core/types';

// ---------------------------------------------------------------------------
// Test Configuration
// ---------------------------------------------------------------------------

const testDbPath = join(import.meta.dir, 'test-time-budget.sqlite');
const testDir = join(import.meta.dir, 'test-time-budget-files');

const testConfig: Config = {
  agentId: 'test-agent',
  dataDir: testDir,
  model: 'mock-model',
  maxTokens: 8192,
  compactionThreshold: 0.8,
  effectiveContextWindow: 180000,
  queueMode: 'steer',
  collectWindowMs: 5000,
  hookTimeoutMs: 600000,
  turnTimeoutMs: 1800000,
  debug: false,
  mcpDebug: false,
  heartbeatIntervalMs: 1800000,
  heartbeatEnabled: false,
  maxConcurrentTasks: 3,
  workPollingIntervalMs: 5000,
  workMaxIterationsPerTask: 100,
  workBudgetMaxTasksPerHour: 50,
};

// ---------------------------------------------------------------------------
// Task Manager + DB Tests
// ---------------------------------------------------------------------------

describe('Per-Task Time Budget', () => {
  let db: Database;
  let eventBus: EventBus;

  beforeEach(async () => {
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    mkdirSync(testDir, { recursive: true });
    db = new Database({ path: testDbPath, enableVec: false });
    await db.initialize();
    eventBus = new EventBus();
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  describe('DB Migration V3', () => {
    it('should add time_budget_ms column to tasks table', () => {
      const row = db.tasks.create({
        subject: 'Migration test',
        description: 'Test V3 migration',
        status: 'pending',
        blockedBy: [],
        blocks: [],
        metadata: {},
        timeBudgetMs: 60000,
        retryCount: 0,
      });
      expect(row.timeBudgetMs).toBe(60000);
    });

    it('should add verify_command column to tasks table', () => {
      const row = db.tasks.create({
        subject: 'Migration test',
        description: 'Test V3 migration',
        status: 'pending',
        blockedBy: [],
        blocks: [],
        metadata: {},
        verifyCommand: 'bun test',
        retryCount: 0,
      });
      expect(row.verifyCommand).toBe('bun test');
    });

    it('should add failure_context column to tasks table', () => {
      const row = db.tasks.create({
        subject: 'Migration test',
        description: 'Test V3 migration',
        status: 'pending',
        blockedBy: [],
        blocks: [],
        metadata: {},
        failureContext: 'Previous attempt failed with timeout',
        retryCount: 0,
      });
      expect(row.failureContext).toBe('Previous attempt failed with timeout');
    });

    it('should add retry_count column with default 0', () => {
      const row = db.tasks.create({
        subject: 'Migration test',
        description: 'Test V3 migration',
        status: 'pending',
        blockedBy: [],
        blocks: [],
        metadata: {},
        retryCount: 0,
      });
      expect(row.retryCount).toBe(0);
    });
  });

  describe('TaskManager creation with timeBudgetMs', () => {
    it('should store timeBudgetMs when creating a task', async () => {
      const taskManager = new TaskManager({ db, eventBus });
      const task = await taskManager.create({
        subject: 'Timed task',
        description: 'Task with time budget',
        timeBudgetMs: 120000,
      });

      expect(task.timeBudgetMs).toBe(120000);

      // Verify persisted in DB
      const retrieved = taskManager.get(task.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.timeBudgetMs).toBe(120000);
    });

    it('should store verifyCommand when creating a task', async () => {
      const taskManager = new TaskManager({ db, eventBus });
      const task = await taskManager.create({
        subject: 'Verified task',
        description: 'Task with verify command',
        verifyCommand: 'bun test --filter unit',
      });

      expect(task.verifyCommand).toBe('bun test --filter unit');

      const retrieved = taskManager.get(task.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.verifyCommand).toBe('bun test --filter unit');
    });

    it('should handle task creation without timeBudgetMs', async () => {
      const taskManager = new TaskManager({ db, eventBus });
      const task = await taskManager.create({
        subject: 'Default task',
        description: 'No time budget specified',
      });

      expect(task.timeBudgetMs).toBeUndefined();

      const retrieved = taskManager.get(task.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.timeBudgetMs).toBeUndefined();
    });

    it('should store both timeBudgetMs and verifyCommand together', async () => {
      const taskManager = new TaskManager({ db, eventBus });
      const task = await taskManager.create({
        subject: 'Full task',
        description: 'Task with both fields',
        timeBudgetMs: 300000,
        verifyCommand: 'curl -f http://localhost:3000/health',
      });

      expect(task.timeBudgetMs).toBe(300000);
      expect(task.verifyCommand).toBe('curl -f http://localhost:3000/health');
    });
  });

  describe('DB update with new fields', () => {
    it('should update timeBudgetMs on an existing task', () => {
      const task = db.tasks.create({
        subject: 'Update test',
        description: 'Test update',
        status: 'pending',
        blockedBy: [],
        blocks: [],
        metadata: {},
        retryCount: 0,
      });

      const updated = db.tasks.update(task.id, { timeBudgetMs: 90000 });
      expect(updated.timeBudgetMs).toBe(90000);
    });

    it('should update failureContext on an existing task', () => {
      const task = db.tasks.create({
        subject: 'Failure test',
        description: 'Test failure context',
        status: 'pending',
        blockedBy: [],
        blocks: [],
        metadata: {},
        retryCount: 0,
      });

      const updated = db.tasks.update(task.id, { failureContext: 'Timed out after 60s' });
      expect(updated.failureContext).toBe('Timed out after 60s');
    });

    it('should update retryCount on an existing task', () => {
      const task = db.tasks.create({
        subject: 'Retry test',
        description: 'Test retry count',
        status: 'pending',
        blockedBy: [],
        blocks: [],
        metadata: {},
        retryCount: 0,
      });

      const updated = db.tasks.update(task.id, { retryCount: 2 });
      expect(updated.retryCount).toBe(2);
    });
  });

  describe('BackgroundTaskRunner timeBudgetMs passthrough', () => {
    it('should accept timeBudgetMs in spawn options', () => {
      const provider = createReadyMockProvider();
      provider.addTextResponse('Done');

      const runner = new BackgroundTaskRunner({
        db, eventBus, config: testConfig, provider,
      });

      const result = runner.spawn('Timed task', 'chat-1', undefined, { timeBudgetMs: 60000 });
      expect(result.ok).toBe(true);

      runner.stopAll();
    });

    it('should spawn without timeBudgetMs (falls back to default)', () => {
      const provider = createReadyMockProvider();
      provider.addTextResponse('Done');

      const runner = new BackgroundTaskRunner({
        db, eventBus, config: testConfig, provider,
      });

      const result = runner.spawn('Default timeout task', 'chat-1');
      expect(result.ok).toBe(true);

      runner.stopAll();
    });
  });

  describe('delegate_task tool timeBudgetMs', () => {
    it('should include timeBudgetMs in tool schema properties', () => {
      const tool = DIALOG_TOOLS.find(t => t.name === 'delegate_task');
      expect(tool).toBeDefined();
      expect(tool!.inputSchema.properties).toHaveProperty('timeBudgetMs');
    });

    it('should pass timeBudgetMs to runner.spawn()', async () => {
      let receivedOptions: { timeBudgetMs?: number } | undefined;
      const runner = {
        spawn: (_desc: string, _key: string, _cb?: unknown, opts?: { timeBudgetMs?: number }) => {
          receivedOptions = opts;
          return { ok: true, taskId: 'task-timed' } as SpawnResult;
        },
        cancel: () => true,
        getTasksForChat: () => [],
        getTask: () => null,
        stopAll: () => {},
      } as unknown as BackgroundTaskRunner;

      const executors = createDialogToolExecutors(runner, 'chat-1');
      const delegate = executors.get('delegate_task')!;

      await delegate('tool-1', { description: 'Timed work', timeBudgetMs: 45000 });

      expect(receivedOptions).toBeDefined();
      expect(receivedOptions!.timeBudgetMs).toBe(45000);
    });

    it('should pass undefined timeBudgetMs when not provided', async () => {
      let receivedOptions: { timeBudgetMs?: number } | undefined;
      const runner = {
        spawn: (_desc: string, _key: string, _cb?: unknown, opts?: { timeBudgetMs?: number }) => {
          receivedOptions = opts;
          return { ok: true, taskId: 'task-default' } as SpawnResult;
        },
        cancel: () => true,
        getTasksForChat: () => [],
        getTask: () => null,
        stopAll: () => {},
      } as unknown as BackgroundTaskRunner;

      const executors = createDialogToolExecutors(runner, 'chat-1');
      const delegate = executors.get('delegate_task')!;

      await delegate('tool-2', { description: 'Default work' });

      expect(receivedOptions).toBeDefined();
      expect(receivedOptions!.timeBudgetMs).toBeUndefined();
    });

    it('should ignore invalid timeBudgetMs values (negative)', async () => {
      let receivedOptions: { timeBudgetMs?: number } | undefined;
      const runner = {
        spawn: (_desc: string, _key: string, _cb?: unknown, opts?: { timeBudgetMs?: number }) => {
          receivedOptions = opts;
          return { ok: true, taskId: 'task-invalid' } as SpawnResult;
        },
        cancel: () => true,
        getTasksForChat: () => [],
        getTask: () => null,
        stopAll: () => {},
      } as unknown as BackgroundTaskRunner;

      const executors = createDialogToolExecutors(runner, 'chat-1');
      const delegate = executors.get('delegate_task')!;

      await delegate('tool-3', { description: 'Invalid budget', timeBudgetMs: -100 });

      expect(receivedOptions!.timeBudgetMs).toBeUndefined();
    });

    it('should ignore non-number timeBudgetMs values', async () => {
      let receivedOptions: { timeBudgetMs?: number } | undefined;
      const runner = {
        spawn: (_desc: string, _key: string, _cb?: unknown, opts?: { timeBudgetMs?: number }) => {
          receivedOptions = opts;
          return { ok: true, taskId: 'task-string' } as SpawnResult;
        },
        cancel: () => true,
        getTasksForChat: () => [],
        getTask: () => null,
        stopAll: () => {},
      } as unknown as BackgroundTaskRunner;

      const executors = createDialogToolExecutors(runner, 'chat-1');
      const delegate = executors.get('delegate_task')!;

      await delegate('tool-4', { description: 'String budget', timeBudgetMs: 'not a number' });

      expect(receivedOptions!.timeBudgetMs).toBeUndefined();
    });
  });
});
