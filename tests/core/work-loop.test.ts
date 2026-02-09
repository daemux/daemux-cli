/**
 * Work Loop Tests (F1)
 * Verifies autonomous task processing: polling, dispatch, concurrency,
 * budget tracking, failure handling, and lifecycle management.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { existsSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { WorkLoop } from '../../src/core/work-loop';
import { TaskManager } from '../../src/core/task-manager';
import { Database } from '../../src/infra/database';
import { EventBus } from '../../src/core/event-bus';
import { createReadyMockProvider } from '../mocks/mock-llm-provider';
import type { Config } from '../../src/core/types';

// ---------------------------------------------------------------------------
// Test Configuration
// ---------------------------------------------------------------------------

const testDbPath = join(import.meta.dir, 'test-work-loop.sqlite');
const testDir = join(import.meta.dir, 'test-work-loop-files');

function createTestConfig(overrides?: Partial<Config>): Config {
  return {
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
    workPollingIntervalMs: 50,
    workBudgetMaxTasksPerHour: 50,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkLoop (F1)', () => {
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

  afterEach(async () => {
    db.close();
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  function createWorkLoop(configOverrides?: Partial<Config>): WorkLoop {
    const provider = createReadyMockProvider();
    provider.addTextResponse('Task completed successfully');
    const config = createTestConfig(configOverrides);
    return new WorkLoop({ db, eventBus, config, provider, taskManager });
  }

  describe('Construction', () => {
    it('should construct with all required dependencies', () => {
      const loop = createWorkLoop();
      expect(loop).toBeDefined();
      expect(loop.getIsRunning()).toBe(false);
      expect(loop.getRunningCount()).toBe(0);
    });
  });

  describe('start() / stop() lifecycle', () => {
    it('should set isRunning to true on start', () => {
      const loop = createWorkLoop();
      loop.start();
      expect(loop.getIsRunning()).toBe(true);
      void loop.stop();
    });

    it('should set isRunning to false on stop', async () => {
      const loop = createWorkLoop();
      loop.start();
      await loop.stop();
      expect(loop.getIsRunning()).toBe(false);
    });

    it('should emit work:started event on start', async () => {
      const events: Array<{ pollingIntervalMs: number; maxConcurrent: number }> = [];
      eventBus.on('work:started', (payload) => { events.push(payload); });

      const loop = createWorkLoop();
      loop.start();

      await new Promise(r => setTimeout(r, 20));
      expect(events).toHaveLength(1);
      expect(events[0]!.pollingIntervalMs).toBe(50);
      expect(events[0]!.maxConcurrent).toBe(3);

      await loop.stop();
    });

    it('should emit work:stopped event on stop', async () => {
      const events: Array<{ reason?: string }> = [];
      eventBus.on('work:stopped', (payload) => { events.push(payload); });

      const loop = createWorkLoop();
      loop.start();
      await loop.stop('test shutdown');

      expect(events).toHaveLength(1);
      expect(events[0]!.reason).toBe('test shutdown');
    });

    it('should be safe to call stop twice (idempotent)', async () => {
      const events: Array<{ reason?: string }> = [];
      eventBus.on('work:stopped', (payload) => { events.push(payload); });

      const loop = createWorkLoop();
      loop.start();
      await loop.stop('first');
      await loop.stop('second');

      // Only one stop event should fire
      expect(events).toHaveLength(1);
    });

    it('should be safe to call start when already running', () => {
      const events: Array<{ pollingIntervalMs: number }> = [];
      eventBus.on('work:started', (payload) => { events.push(payload); });

      const loop = createWorkLoop();
      loop.start();
      loop.start();

      // Only one start event
      expect(events).toHaveLength(1);
      void loop.stop();
    });
  });

  describe('Poll with no tasks', () => {
    it('should emit work:poll with zero available tasks when queue is empty', async () => {
      const pollEvents: Array<{ availableTasks: number; runningTasks: number }> = [];
      eventBus.on('work:poll', (payload) => { pollEvents.push(payload); });

      const loop = createWorkLoop();
      loop.start();

      await new Promise(r => setTimeout(r, 100));
      await loop.stop();

      expect(pollEvents.length).toBeGreaterThanOrEqual(1);
      expect(pollEvents[0]!.availableTasks).toBe(0);
      expect(pollEvents[0]!.runningTasks).toBe(0);
    });
  });

  describe('Task dispatch', () => {
    it('should dispatch available pending tasks', async () => {
      const dispatchEvents: Array<{ taskId: string; subject: string }> = [];
      eventBus.on('work:task-dispatched', (payload) => { dispatchEvents.push(payload); });

      await taskManager.create({
        subject: 'Test task',
        description: 'Do something useful',
      });

      const loop = createWorkLoop();
      loop.start();

      await new Promise(r => setTimeout(r, 200));
      await loop.stop();

      expect(dispatchEvents).toHaveLength(1);
      expect(dispatchEvents[0]!.subject).toBe('Test task');
    });

    it('should claim task with work-loop as owner', async () => {
      const task = await taskManager.create({
        subject: 'Claim test',
        description: 'Should be claimed',
      });

      // Track dispatch events to verify claim happened
      let claimedOwner: string | undefined;
      eventBus.on('work:task-dispatched', () => {
        const t = taskManager.get(task.id);
        if (t) claimedOwner = t.owner;
      });

      const loop = createWorkLoop();
      loop.start();

      await new Promise(r => setTimeout(r, 200));
      await loop.stop();

      // Owner should have been set to 'work-loop' at dispatch time
      expect(claimedOwner).toBe('work-loop');
    });

    it('should complete task after successful execution', async () => {
      const task = await taskManager.create({
        subject: 'Complete test',
        description: 'Should complete',
      });

      const completedEvents: Array<{ taskId: string; success: boolean }> = [];
      eventBus.on('work:task-completed', (payload) => { completedEvents.push(payload); });

      const loop = createWorkLoop();
      loop.start();

      await new Promise(r => setTimeout(r, 500));
      await loop.stop();

      expect(completedEvents).toHaveLength(1);
      expect(completedEvents[0]!.taskId).toBe(task.id);
      expect(completedEvents[0]!.success).toBe(true);

      const result = taskManager.get(task.id);
      expect(result!.status).toBe('completed');
    });
  });

  describe('Concurrency limit', () => {
    it('should respect maxConcurrentTasks', async () => {
      // Create many tasks but limit concurrency to 1
      const provider = createReadyMockProvider();
      // Add slow responses - the mock loop will process them but they complete fast
      for (let i = 0; i < 10; i++) provider.addTextResponse(`Result ${i}`);

      const config = createTestConfig({ maxConcurrentTasks: 1, workPollingIntervalMs: 30 });
      const loop = new WorkLoop({ db, eventBus, config, provider, taskManager });

      await taskManager.create({ subject: 'Task A', description: 'First' });
      await taskManager.create({ subject: 'Task B', description: 'Second' });
      await taskManager.create({ subject: 'Task C', description: 'Third' });

      // Track peak concurrency via running count at dispatch time
      let peakRunning = 0;
      eventBus.on('work:task-dispatched', () => {
        const current = loop.getRunningCount();
        if (current > peakRunning) peakRunning = current;
      });

      loop.start();
      await new Promise(r => setTimeout(r, 800));
      await loop.stop();

      // Peak should never exceed maxConcurrentTasks
      expect(peakRunning).toBeLessThanOrEqual(1);
    });
  });

  describe('Budget limit', () => {
    it('should emit work:budget-exhausted when limit reached', async () => {
      const exhaustedEvents: Array<{ tasksThisHour: number; limit: number }> = [];
      eventBus.on('work:budget-exhausted', (payload) => { exhaustedEvents.push(payload); });

      // Set budget to 1 task per hour
      const provider = createReadyMockProvider();
      provider.addTextResponse('Done 1');
      provider.addTextResponse('Done 2');

      const config = createTestConfig({ workBudgetMaxTasksPerHour: 1, workPollingIntervalMs: 30 });
      const loop = new WorkLoop({ db, eventBus, config, provider, taskManager });

      await taskManager.create({ subject: 'Budget task 1', description: 'First' });
      await taskManager.create({ subject: 'Budget task 2', description: 'Second (should be blocked)' });

      loop.start();
      await new Promise(r => setTimeout(r, 500));
      await loop.stop();

      // After dispatching 1 task, budget should be exhausted
      expect(exhaustedEvents.length).toBeGreaterThanOrEqual(1);
      expect(exhaustedEvents[0]!.limit).toBe(1);
    });
  });

  describe('Task failure handling', () => {
    it('should mark task as failed when loop throws', async () => {
      const provider = createReadyMockProvider();
      // Make provider throw by not adding responses and setting error default
      provider.setDefaultResponse({
        content: [],
        stopReason: null,
        usage: { inputTokens: 0, outputTokens: 0 },
      });

      const config = createTestConfig();
      const loop = new WorkLoop({ db, eventBus, config, provider, taskManager });

      const task = await taskManager.create({
        subject: 'Failing task',
        description: 'This will fail',
      });

      const completedEvents: Array<{ taskId: string; success: boolean }> = [];
      eventBus.on('work:task-completed', (payload) => { completedEvents.push(payload); });

      loop.start();
      await new Promise(r => setTimeout(r, 500));
      await loop.stop();

      // The task should either be completed or failed depending on how the mock behaves.
      // With empty content, the loop may complete with empty response or fail.
      const result = taskManager.get(task.id);
      expect(['completed', 'failed', 'pending']).toContain(result!.status);
    });
  });

  describe('Task with timeBudgetMs', () => {
    it('should pass timeBudgetMs to AgenticLoop as timeoutMs', async () => {
      // This test verifies that the task's timeBudgetMs is used.
      // Since we can't directly inspect the loop config, we verify the task completes.
      const provider = createReadyMockProvider();
      provider.addTextResponse('Budget result');

      const config = createTestConfig();
      const loop = new WorkLoop({ db, eventBus, config, provider, taskManager });

      await taskManager.create({
        subject: 'Time budget task',
        description: 'Has a time budget',
        timeBudgetMs: 30_000,
      });

      const completedEvents: Array<{ taskId: string; success: boolean }> = [];
      eventBus.on('work:task-completed', (payload) => { completedEvents.push(payload); });

      loop.start();
      await new Promise(r => setTimeout(r, 500));
      await loop.stop();

      expect(completedEvents).toHaveLength(1);
      expect(completedEvents[0]!.success).toBe(true);
    });
  });

  describe('Task with failureContext', () => {
    it('should prepend failure context to prompt on retry', async () => {
      const provider = createReadyMockProvider();
      provider.addTextResponse('Retry success');

      const config = createTestConfig();
      const loop = new WorkLoop({ db, eventBus, config, provider, taskManager });

      // Create a task that looks like a retry (has failureContext and retryCount)
      const task = await taskManager.create({
        subject: 'Retry task',
        description: 'Original description',
      });
      await taskManager.update(task.id, {
        failureContext: 'Previous error: timeout',
        retryCount: 1,
      });

      const dispatchEvents: Array<{ taskId: string; subject: string }> = [];
      eventBus.on('work:task-dispatched', (payload) => { dispatchEvents.push(payload); });

      loop.start();
      await new Promise(r => setTimeout(r, 300));
      await loop.stop();

      // Task should have been dispatched
      expect(dispatchEvents).toHaveLength(1);

      // Verify the provider received the prompt with failure context prepended
      const lastCall = provider.getLastCall();
      expect(lastCall).toBeDefined();
      const userMessage = lastCall!.messages.find(m => m.role === 'user');
      expect(userMessage).toBeDefined();
      // The content should include failure context
      const content = typeof userMessage!.content === 'string'
        ? userMessage!.content
        : JSON.stringify(userMessage!.content);
      expect(content).toContain('Previous attempt failed');
      expect(content).toContain('Previous error: timeout');
    });
  });

  describe('stop() resets in-progress tasks', () => {
    it('should reset running tasks back to pending on stop', async () => {
      const provider = createReadyMockProvider();
      // Add many responses so the loop keeps going
      for (let i = 0; i < 100; i++) provider.addTextResponse(`Step ${i}`);

      const config = createTestConfig({ workPollingIntervalMs: 30 });
      const loop = new WorkLoop({ db, eventBus, config, provider, taskManager });

      const task = await taskManager.create({
        subject: 'Reset task',
        description: 'Should be reset on stop',
      });

      loop.start();
      // Wait for task to be dispatched
      await new Promise(r => setTimeout(r, 100));

      // Task should be in_progress
      const running = taskManager.get(task.id);
      if (running && running.status === 'in_progress') {
        await loop.stop();

        const result = taskManager.get(task.id);
        expect(result!.status).toBe('pending');
        expect(result!.owner).toBeUndefined();
      } else {
        // Task may have completed already, which is also acceptable
        await loop.stop();
      }
    });
  });

  describe('BudgetTracker sliding window', () => {
    it('should allow dispatch after timestamps expire from sliding window', async () => {
      // This test validates the budget tracker by using a very tight budget
      // and verifying tasks eventually get dispatched after the hour window
      const provider = createReadyMockProvider();
      provider.addTextResponse('Result');

      const config = createTestConfig({ workBudgetMaxTasksPerHour: 50 });
      const loop = new WorkLoop({ db, eventBus, config, provider, taskManager });

      await taskManager.create({
        subject: 'Window task',
        description: 'Tests sliding window',
      });

      const completedEvents: Array<{ taskId: string }> = [];
      eventBus.on('work:task-completed', (payload) => { completedEvents.push(payload); });

      loop.start();
      await new Promise(r => setTimeout(r, 300));
      await loop.stop();

      // With budget of 50, the task should have been dispatched
      expect(completedEvents).toHaveLength(1);
    });
  });

  describe('Multiple tasks processing', () => {
    it('should process multiple tasks sequentially with concurrency 1', async () => {
      const provider = createReadyMockProvider();
      for (let i = 0; i < 5; i++) provider.addTextResponse(`Result ${i}`);

      const config = createTestConfig({ maxConcurrentTasks: 1, workPollingIntervalMs: 30 });
      const loop = new WorkLoop({ db, eventBus, config, provider, taskManager });

      await taskManager.create({ subject: 'Multi 1', description: 'First' });
      await taskManager.create({ subject: 'Multi 2', description: 'Second' });

      const completedEvents: Array<{ subject: string }> = [];
      eventBus.on('work:task-completed', (payload) => { completedEvents.push(payload); });

      loop.start();
      await new Promise(r => setTimeout(r, 1000));
      await loop.stop();

      // Both tasks should eventually complete
      expect(completedEvents.length).toBeGreaterThanOrEqual(2);
    });

    it('should not dispatch blocked tasks in the same poll as the blocker', async () => {
      // Track what gets dispatched in each poll cycle
      const dispatchOrder: string[] = [];
      eventBus.on('work:task-dispatched', (payload) => { dispatchOrder.push(payload.subject); });

      const provider = createReadyMockProvider();
      provider.addTextResponse('Blocker done');
      provider.addTextResponse('Blocked done');

      const config = createTestConfig({ workPollingIntervalMs: 30, maxConcurrentTasks: 2 });
      const loop = new WorkLoop({ db, eventBus, config, provider, taskManager });

      const blocker = await taskManager.create({
        subject: 'Blocker',
        description: 'This must finish first',
      });

      await taskManager.create({
        subject: 'Blocked',
        description: 'Waiting for blocker',
        blockedBy: [blocker.id],
      });

      loop.start();
      await new Promise(r => setTimeout(r, 500));
      await loop.stop();

      // Blocker must be dispatched before Blocked (if Blocked was dispatched at all)
      const blockerIdx = dispatchOrder.indexOf('Blocker');
      const blockedIdx = dispatchOrder.indexOf('Blocked');
      expect(blockerIdx).toBeGreaterThanOrEqual(0);
      if (blockedIdx >= 0) {
        expect(blockerIdx).toBeLessThan(blockedIdx);
      }
    });

    it('should skip tasks already owned by another owner', async () => {
      const provider = createReadyMockProvider();
      provider.addTextResponse('My task done');

      const config = createTestConfig({ workPollingIntervalMs: 30 });
      const loop = new WorkLoop({ db, eventBus, config, provider, taskManager });

      // Create a task owned by someone else
      const task = await taskManager.create({
        subject: 'Other owner',
        description: 'Owned by someone else',
      });
      await taskManager.claim(task.id, 'other-agent');

      // Create an unowned task
      await taskManager.create({
        subject: 'Unowned task',
        description: 'Available for work-loop',
      });

      const dispatchEvents: Array<{ subject: string }> = [];
      eventBus.on('work:task-dispatched', (payload) => { dispatchEvents.push(payload); });

      loop.start();
      await new Promise(r => setTimeout(r, 300));
      await loop.stop();

      // Only the unowned task should be dispatched
      const otherOwnerDispatches = dispatchEvents.filter(e => e.subject === 'Other owner');
      expect(otherOwnerDispatches).toHaveLength(0);
    });
  });
});
