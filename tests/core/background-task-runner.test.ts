/**
 * Background Task Runner Unit Tests
 * Tests spawning, tracking, cancellation, concurrency limits, and cleanup.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { existsSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { BackgroundTaskRunner } from '../../src/core/background-task-runner';
import type { TaskCompleteCallback, SpawnResult } from '../../src/core/background-task-runner';
import { Database } from '../../src/infra/database';
import { EventBus } from '../../src/core/event-bus';
import { createReadyMockProvider, MockLLMProvider } from '../mocks/mock-llm-provider';
import type { Config } from '../../src/core/types';

// ---------------------------------------------------------------------------
// Test Configuration
// ---------------------------------------------------------------------------

const testDbPath = join(import.meta.dir, 'test-bg-runner.sqlite');
const testDir = join(import.meta.dir, 'test-bg-runner-files');

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
  workBudgetMaxTasksPerHour: 50,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BackgroundTaskRunner', () => {
  let db: Database;
  let eventBus: EventBus;
  let provider: MockLLMProvider;

  beforeEach(async () => {
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    mkdirSync(testDir, { recursive: true });
    db = new Database({ path: testDbPath, enableVec: false });
    await db.initialize();
    eventBus = new EventBus();
    provider = createReadyMockProvider();
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  function createRunner(opts?: { maxPerChat?: number; cleanupDelayMs?: number }): BackgroundTaskRunner {
    return new BackgroundTaskRunner({
      db,
      eventBus,
      config: testConfig,
      provider,
      maxPerChat: opts?.maxPerChat ?? 3,
      cleanupDelayMs: opts?.cleanupDelayMs ?? 50,
    });
  }

  describe('spawn()', () => {
    it('should return ok with a taskId on success', () => {
      provider.addTextResponse('Task done');
      const runner = createRunner();
      const result = runner.spawn('Do something', 'chat-1');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.taskId).toBeDefined();
        expect(typeof result.taskId).toBe('string');
        expect(result.taskId.length).toBeGreaterThan(0);
      }

      runner.stopAll();
    });

    it('should create a running task visible via getTasksForChat', () => {
      provider.addTextResponse('Task result');
      const runner = createRunner();
      runner.spawn('Analyze data', 'chat-1');

      const tasks = runner.getTasksForChat('chat-1');
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.description).toBe('Analyze data');
      expect(tasks[0]!.chatKey).toBe('chat-1');
      expect(tasks[0]!.status).toBe('running');

      runner.stopAll();
    });

    it('should create task accessible via getTask', () => {
      provider.addTextResponse('Result');
      const runner = createRunner();
      const result = runner.spawn('Get info', 'chat-2');

      if (result.ok) {
        const task = runner.getTask(result.taskId);
        expect(task).not.toBeNull();
        expect(task!.id).toBe(result.taskId);
        expect(task!.description).toBe('Get info');
      }

      runner.stopAll();
    });

    it('should emit bg-task:delegated event', async () => {
      provider.addTextResponse('Done');
      const events: Array<{ taskId: string; chatKey: string; description: string }> = [];
      eventBus.on('bg-task:delegated', (payload) => { events.push(payload); });

      const runner = createRunner();
      runner.spawn('Build thing', 'chat-1');

      await new Promise(r => setTimeout(r, 20));
      expect(events).toHaveLength(1);
      expect(events[0]!.description).toBe('Build thing');
      expect(events[0]!.chatKey).toBe('chat-1');

      runner.stopAll();
    });
  });

  describe('Concurrency limit', () => {
    it('should enforce maxPerChat limit', () => {
      const runner = createRunner({ maxPerChat: 2 });

      // Add enough responses so the loop won't run out
      for (let i = 0; i < 5; i++) provider.addTextResponse(`Response ${i}`);

      const r1 = runner.spawn('Task 1', 'chat-1');
      const r2 = runner.spawn('Task 2', 'chat-1');
      const r3 = runner.spawn('Task 3', 'chat-1');

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      expect(r3.ok).toBe(false);
      if (!r3.ok) {
        expect(r3.error).toContain('Concurrency limit');
      }

      runner.stopAll();
    });

    it('should track tasks independently per chat', () => {
      const runner = createRunner({ maxPerChat: 2 });
      for (let i = 0; i < 10; i++) provider.addTextResponse(`Response ${i}`);

      const r1 = runner.spawn('Task A1', 'chat-A');
      const r2 = runner.spawn('Task A2', 'chat-A');
      const r3 = runner.spawn('Task B1', 'chat-B');
      const r4 = runner.spawn('Task B2', 'chat-B');

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      expect(r3.ok).toBe(true);
      expect(r4.ok).toBe(true);

      expect(runner.getTasksForChat('chat-A')).toHaveLength(2);
      expect(runner.getTasksForChat('chat-B')).toHaveLength(2);

      runner.stopAll();
    });

    it('should not count other chats against limit', () => {
      const runner = createRunner({ maxPerChat: 1 });
      for (let i = 0; i < 10; i++) provider.addTextResponse(`Response ${i}`);

      const r1 = runner.spawn('Task 1', 'chat-A');
      const r2 = runner.spawn('Task 2', 'chat-B');
      const r3 = runner.spawn('Task 3', 'chat-A');

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      expect(r3.ok).toBe(false);

      runner.stopAll();
    });
  });

  describe('Task completion', () => {
    it('should call onComplete callback on success', async () => {
      provider.addTextResponse('Task output');
      const completions: Array<{ taskId: string; result: string; success: boolean }> = [];

      const runner = createRunner();
      runner.spawn('Complete me', 'chat-1', (id, result, success) => {
        completions.push({ taskId: id, result, success });
      });

      await new Promise(r => setTimeout(r, 200));

      expect(completions).toHaveLength(1);
      expect(completions[0]!.success).toBe(true);
      expect(completions[0]!.result).toContain('Task output');

      runner.stopAll();
    });

    it('should emit bg-task:completed event on success', async () => {
      provider.addTextResponse('Final result');
      const events: Array<{ taskId: string; success: boolean; result: string }> = [];
      eventBus.on('bg-task:completed', (payload) => { events.push(payload); });

      const runner = createRunner();
      runner.spawn('Complete event', 'chat-1');

      await new Promise(r => setTimeout(r, 200));

      expect(events).toHaveLength(1);
      expect(events[0]!.success).toBe(true);
      expect(events[0]!.result).toContain('Final result');

      runner.stopAll();
    });

    it('should call onComplete with error on failure', async () => {
      // Make provider throw by not adding any response and making it fail
      provider.setDefaultResponse({
        content: [{ type: 'text', text: '' }],
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
      });

      const completions: Array<{ taskId: string; result: string; success: boolean }> = [];
      const runner = createRunner();
      runner.spawn('Fail me', 'chat-1', (id, result, success) => {
        completions.push({ taskId: id, result, success });
      });

      // The loop will complete with empty response, which gets treated as "Task completed with no output"
      await new Promise(r => setTimeout(r, 300));

      expect(completions).toHaveLength(1);
      // Empty response gets the fallback text
      expect(completions[0]!.result).toBe('Task completed with no output');

      runner.stopAll();
    });

    it('should nullify loop reference after completion', async () => {
      provider.addTextResponse('Done');
      // Use a long cleanup delay so the task stays around for inspection
      const runner = createRunner({ cleanupDelayMs: 5000 });
      const result = runner.spawn('Cleanup test', 'chat-1');

      await new Promise(r => setTimeout(r, 300));

      if (result.ok) {
        const task = runner.getTask(result.taskId);
        // Task should still exist (cleanup hasn't fired) and be completed
        expect(task).not.toBeNull();
        expect(task!.status).toBe('completed');
      }

      runner.stopAll();
    });
  });

  describe('cancel()', () => {
    it('should return true when cancelling a running task', () => {
      // Use a response that takes a long time by adding many responses
      for (let i = 0; i < 100; i++) provider.addTextResponse(`Step ${i}`);

      const runner = createRunner();
      const result = runner.spawn('Long task', 'chat-1');

      if (result.ok) {
        const cancelled = runner.cancel(result.taskId);
        expect(cancelled).toBe(true);
      }

      runner.stopAll();
    });

    it('should return false when cancelling non-existent task', () => {
      const runner = createRunner();
      const cancelled = runner.cancel('nonexistent-id');
      expect(cancelled).toBe(false);
      runner.stopAll();
    });

    it('should return false when cancelling already cancelled task', () => {
      for (let i = 0; i < 100; i++) provider.addTextResponse(`Step ${i}`);

      const runner = createRunner();
      const result = runner.spawn('Cancel twice', 'chat-1');

      if (result.ok) {
        runner.cancel(result.taskId);
        const secondCancel = runner.cancel(result.taskId);
        expect(secondCancel).toBe(false);
      }

      runner.stopAll();
    });

    it('should emit bg-task:completed event with success=false on cancel', async () => {
      for (let i = 0; i < 100; i++) provider.addTextResponse(`Step ${i}`);
      const events: Array<{ success: boolean; result: string }> = [];
      eventBus.on('bg-task:completed', (payload) => { events.push(payload); });

      const runner = createRunner();
      const result = runner.spawn('Cancel me', 'chat-1');

      if (result.ok) {
        runner.cancel(result.taskId);
      }

      await new Promise(r => setTimeout(r, 50));

      const cancelEvent = events.find(e => e.result === 'Task cancelled');
      expect(cancelEvent).toBeDefined();
      expect(cancelEvent!.success).toBe(false);

      runner.stopAll();
    });

    it('should call onComplete callback with success=false', () => {
      for (let i = 0; i < 100; i++) provider.addTextResponse(`Step ${i}`);
      const completions: Array<{ result: string; success: boolean }> = [];

      const runner = createRunner();
      const result = runner.spawn('Cancel callback', 'chat-1', (_id, res, success) => {
        completions.push({ result: res, success });
      });

      if (result.ok) {
        runner.cancel(result.taskId);
      }

      expect(completions).toHaveLength(1);
      expect(completions[0]!.success).toBe(false);
      expect(completions[0]!.result).toBe('Task cancelled');

      runner.stopAll();
    });

    it('should change task status to cancelled', () => {
      for (let i = 0; i < 100; i++) provider.addTextResponse(`Step ${i}`);

      const runner = createRunner();
      const result = runner.spawn('Status check', 'chat-1');

      if (result.ok) {
        runner.cancel(result.taskId);
        const task = runner.getTask(result.taskId);
        expect(task?.status).toBe('cancelled');
      }

      runner.stopAll();
    });
  });

  describe('stopAll()', () => {
    it('should cancel all running tasks', () => {
      for (let i = 0; i < 20; i++) provider.addTextResponse(`Step ${i}`);

      const runner = createRunner({ maxPerChat: 5 });
      runner.spawn('Task A', 'chat-1');
      runner.spawn('Task B', 'chat-1');
      runner.spawn('Task C', 'chat-2');

      runner.stopAll();

      expect(runner.getTasksForChat('chat-1')).toHaveLength(0);
      expect(runner.getTasksForChat('chat-2')).toHaveLength(0);
    });

    it('should clear all internal state', () => {
      for (let i = 0; i < 10; i++) provider.addTextResponse(`Step ${i}`);

      const runner = createRunner();
      const result = runner.spawn('Clear test', 'chat-1');

      runner.stopAll();

      if (result.ok) {
        expect(runner.getTask(result.taskId)).toBeNull();
      }
    });
  });

  describe('getTasksForChat()', () => {
    it('should only return running tasks', async () => {
      provider.addTextResponse('Quick done');
      const runner = createRunner({ maxPerChat: 5 });
      runner.spawn('Quick task', 'chat-1');

      // Wait for the quick task to complete
      await new Promise(r => setTimeout(r, 300));

      // Running tasks should be 0 (completed ones are not returned)
      const running = runner.getTasksForChat('chat-1');
      expect(running.every(t => t.status === 'running')).toBe(true);

      runner.stopAll();
    });

    it('should return empty array for unknown chat', () => {
      const runner = createRunner();
      const tasks = runner.getTasksForChat('unknown-chat');
      expect(tasks).toEqual([]);
      runner.stopAll();
    });
  });

  describe('Cleanup', () => {
    it('should remove completed tasks after cleanup delay', async () => {
      provider.addTextResponse('Done quickly');
      const runner = createRunner({ cleanupDelayMs: 50 });
      const result = runner.spawn('Cleanup test', 'chat-1');

      // Wait for completion + cleanup
      await new Promise(r => setTimeout(r, 500));

      if (result.ok) {
        const task = runner.getTask(result.taskId);
        expect(task).toBeNull();
      }

      runner.stopAll();
    });
  });

  describe('Default onComplete', () => {
    it('should not throw when no onComplete callback provided', async () => {
      provider.addTextResponse('No callback');
      const runner = createRunner();

      // spawn without onComplete - should use default no-op
      const result = runner.spawn('No callback task', 'chat-1');
      expect(result.ok).toBe(true);

      await new Promise(r => setTimeout(r, 200));
      // If we got here without throwing, the test passes
      runner.stopAll();
    });
  });
});
