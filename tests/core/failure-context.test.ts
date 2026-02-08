/**
 * Failure Context Tests (F5)
 * Verifies fail(), retry() methods on TaskManager,
 * and failure context injection in BackgroundTaskRunner.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { existsSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { TaskManager } from '../../src/core/task-manager';
import { Database } from '../../src/infra/database';
import { EventBus } from '../../src/core/event-bus';
import { BackgroundTaskRunner } from '../../src/core/background-task-runner';
import { createReadyMockProvider } from '../mocks/mock-llm-provider';
import type { Config } from '../../src/core/types';

// ---------------------------------------------------------------------------
// Test Configuration
// ---------------------------------------------------------------------------

const testDbPath = join(import.meta.dir, 'test-failure-context.sqlite');
const testDir = join(import.meta.dir, 'test-failure-context-files');

const testConfig: Config = {
  agentId: 'test-agent',
  dataDir: testDir,
  model: 'mock-model',
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
// Tests
// ---------------------------------------------------------------------------

describe('Failure Context (F5)', () => {
  let db: Database;
  let eventBus: EventBus;
  let taskManager: TaskManager;

  beforeEach(async () => {
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    mkdirSync(testDir, { recursive: true });
    db = new Database({ path: testDbPath, enableVec: false });
    await db.initialize();
    eventBus = new EventBus();
    taskManager = new TaskManager({ db, eventBus });
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  describe('TaskManager.fail()', () => {
    it('should set status to failed', async () => {
      const task = await taskManager.create({
        subject: 'Fail test',
        description: 'Task that will fail',
      });

      const failed = await taskManager.fail(task.id, 'Connection timeout');
      expect(failed.status).toBe('failed');
    });

    it('should store error message in failureContext', async () => {
      const task = await taskManager.create({
        subject: 'Error capture',
        description: 'Task to capture error',
      });

      const failed = await taskManager.fail(task.id, 'ECONNREFUSED 127.0.0.1:5432');
      expect(failed.failureContext).toBe('ECONNREFUSED 127.0.0.1:5432');
    });

    it('should truncate failureContext to 2000 chars', async () => {
      const task = await taskManager.create({
        subject: 'Long error',
        description: 'Task with long error',
      });

      const longError = 'x'.repeat(3000);
      const failed = await taskManager.fail(task.id, longError);
      expect(failed.failureContext!.length).toBe(2000);
    });

    it('should increment retryCount from 0 to 1 on first failure', async () => {
      const task = await taskManager.create({
        subject: 'Retry count',
        description: 'Track retries',
      });

      expect(task.retryCount).toBe(0);
      const failed = await taskManager.fail(task.id, 'First failure');
      expect(failed.retryCount).toBe(1);
    });

    it('should increment retryCount on successive failures', async () => {
      const task = await taskManager.create({
        subject: 'Multi-retry',
        description: 'Multiple retries',
      });

      // First fail
      await taskManager.fail(task.id, 'Attempt 1 error');
      // Retry to reset to pending
      await taskManager.retry(task.id);
      // Second fail
      const failedAgain = await taskManager.fail(task.id, 'Attempt 2 error');

      expect(failedAgain.retryCount).toBe(2);
      expect(failedAgain.failureContext).toBe('Attempt 2 error');
    });

    it('should throw for nonexistent task', async () => {
      await expect(
        taskManager.fail('nonexistent-id', 'Some error')
      ).rejects.toThrow('Task nonexistent-id not found');
    });

    it('should persist failureContext in DB', async () => {
      const task = await taskManager.create({
        subject: 'DB persist',
        description: 'Check DB persistence',
      });

      await taskManager.fail(task.id, 'Persisted error');

      const retrieved = taskManager.get(task.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.failureContext).toBe('Persisted error');
      expect(retrieved!.retryCount).toBe(1);
      expect(retrieved!.status).toBe('failed');
    });
  });

  describe('TaskManager.retry()', () => {
    it('should reset status to pending', async () => {
      const task = await taskManager.create({
        subject: 'Retry pending',
        description: 'Reset to pending',
      });

      await taskManager.fail(task.id, 'Failed once');
      const retried = await taskManager.retry(task.id);

      expect(retried.status).toBe('pending');
    });

    it('should clear owner', async () => {
      const task = await taskManager.create({
        subject: 'Retry clear owner',
        description: 'Clear owner on retry',
        owner: 'agent-1',
      });

      await taskManager.update(task.id, { status: 'in_progress' });
      await taskManager.fail(task.id, 'Failed with owner');

      const retried = await taskManager.retry(task.id);
      expect(retried.owner).toBeUndefined();
    });

    it('should preserve failureContext across retry', async () => {
      const task = await taskManager.create({
        subject: 'Preserve context',
        description: 'Context stays after retry',
      });

      await taskManager.fail(task.id, 'Error message preserved');
      const retried = await taskManager.retry(task.id);

      expect(retried.failureContext).toBe('Error message preserved');
    });

    it('should preserve retryCount across retry', async () => {
      const task = await taskManager.create({
        subject: 'Preserve count',
        description: 'Count stays after retry',
      });

      await taskManager.fail(task.id, 'First fail');
      const retried = await taskManager.retry(task.id);

      expect(retried.retryCount).toBe(1);
    });

    it('should throw if task is not in failed status', async () => {
      const task = await taskManager.create({
        subject: 'Not failed',
        description: 'Still pending',
      });

      await expect(
        taskManager.retry(task.id)
      ).rejects.toThrow(`Task ${task.id} is not in failed status`);
    });

    it('should throw for nonexistent task', async () => {
      await expect(
        taskManager.retry('nonexistent-id')
      ).rejects.toThrow('Task nonexistent-id not found');
    });

    it('should throw if task is completed (not failed)', async () => {
      const task = await taskManager.create({
        subject: 'Completed task',
        description: 'Cannot retry completed',
      });

      await taskManager.complete(task.id);

      await expect(
        taskManager.retry(task.id)
      ).rejects.toThrow(`Task ${task.id} is not in failed status`);
    });
  });

  describe('TaskStatusSchema includes failed', () => {
    it('should allow failed status in task creation at DB level', () => {
      const task = db.tasks.create({
        subject: 'Failed task',
        description: 'Created with failed status',
        status: 'failed',
        blockedBy: [],
        blocks: [],
        metadata: {},
        retryCount: 1,
        failureContext: 'Pre-existing failure',
      });

      expect(task.status).toBe('failed');
      expect(task.failureContext).toBe('Pre-existing failure');
    });
  });

  describe('BackgroundTaskRunner failure context injection', () => {
    it('should prepend failure context to description on retry', () => {
      const provider = createReadyMockProvider();
      provider.addTextResponse('Retried successfully');

      const runner = new BackgroundTaskRunner({
        db, eventBus, config: testConfig, provider,
      });

      const events: Array<{ description: string }> = [];
      eventBus.on('bg-task:delegated', (payload) => { events.push(payload); });

      runner.spawn(
        'Fix the bug',
        'chat-1',
        undefined,
        { failureContext: 'TypeError: null is not an object', retryCount: 1 },
      );

      expect(events).toHaveLength(1);
      expect(events[0]!.description).toContain('Previous attempt failed: TypeError: null is not an object');
      expect(events[0]!.description).toContain('This is attempt 2');
      expect(events[0]!.description).toContain('Try a different approach');
      expect(events[0]!.description).toContain('Fix the bug');

      runner.stopAll();
    });

    it('should not modify description when no failure context', () => {
      const provider = createReadyMockProvider();
      provider.addTextResponse('Fresh task');

      const runner = new BackgroundTaskRunner({
        db, eventBus, config: testConfig, provider,
      });

      const events: Array<{ description: string }> = [];
      eventBus.on('bg-task:delegated', (payload) => { events.push(payload); });

      runner.spawn('Do something new', 'chat-1');

      expect(events).toHaveLength(1);
      expect(events[0]!.description).toBe('Do something new');

      runner.stopAll();
    });

    it('should not modify description when retryCount is 0', () => {
      const provider = createReadyMockProvider();
      provider.addTextResponse('First attempt');

      const runner = new BackgroundTaskRunner({
        db, eventBus, config: testConfig, provider,
      });

      const events: Array<{ description: string }> = [];
      eventBus.on('bg-task:delegated', (payload) => { events.push(payload); });

      runner.spawn(
        'Original description',
        'chat-1',
        undefined,
        { failureContext: 'some context', retryCount: 0 },
      );

      expect(events).toHaveLength(1);
      expect(events[0]!.description).toBe('Original description');

      runner.stopAll();
    });

    it('should pass failure context through to the running task record', () => {
      const provider = createReadyMockProvider();
      provider.addTextResponse('Retried');

      const runner = new BackgroundTaskRunner({
        db, eventBus, config: testConfig, provider,
      });

      const result = runner.spawn(
        'Retry task',
        'chat-1',
        undefined,
        { failureContext: 'Previous error', retryCount: 2 },
      );

      if (result.ok) {
        const task = runner.getTask(result.taskId);
        expect(task).not.toBeNull();
        expect(task!.description).toContain('Previous attempt failed: Previous error');
        expect(task!.description).toContain('This is attempt 3');
      }

      runner.stopAll();
    });
  });
});
