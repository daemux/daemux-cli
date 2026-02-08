/**
 * Task Verifier Tests (F3)
 * Verifies that TaskVerifier runs bash verification commands on completed tasks,
 * handles pass/fail/retry/timeout, and emits the correct events.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { existsSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { TaskVerifier } from '../../src/core/task-verifier';
import { TaskManager } from '../../src/core/task-manager';
import { Database } from '../../src/infra/database';
import { EventBus } from '../../src/core/event-bus';

// ---------------------------------------------------------------------------
// Test Configuration
// ---------------------------------------------------------------------------

const testDbPath = join(import.meta.dir, 'test-task-verifier.sqlite');
const testDir = join(import.meta.dir, 'test-task-verifier-files');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Task Verifier (F3)', () => {
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

  describe('handleCompletion - no verifyCommand', () => {
    it('should skip verification when task has no verifyCommand', async () => {
      const task = await taskManager.create({
        subject: 'No verify',
        description: 'Task without verification',
      });

      const verifier = new TaskVerifier({ eventBus, taskManager });

      // Complete the task
      const completed = await taskManager.complete(task.id);
      await verifier.handleCompletion(completed);

      // Task should remain completed
      const result = taskManager.get(task.id);
      expect(result!.status).toBe('completed');
      expect(result!.metadata).not.toHaveProperty('verifyPassed');
    });
  });

  describe('handleCompletion - verification passes', () => {
    it('should keep task completed and set verifyPassed metadata', async () => {
      const task = await taskManager.create({
        subject: 'Pass verify',
        description: 'Task with passing verification',
        verifyCommand: 'true',
      });

      const verifier = new TaskVerifier({ eventBus, taskManager });

      const completed = await taskManager.complete(task.id);
      await verifier.handleCompletion(completed);

      const result = taskManager.get(task.id);
      expect(result!.status).toBe('completed');
      expect(result!.metadata.verifyPassed).toBe(true);
    });

    it('should emit task:verification_passed event', async () => {
      const task = await taskManager.create({
        subject: 'Event pass',
        description: 'Check event emission',
        verifyCommand: 'echo "ok" && exit 0',
      });

      const verifier = new TaskVerifier({ eventBus, taskManager });

      const passedEvents: Array<{ taskId: string; subject: string }> = [];
      eventBus.on('task:verification_passed', (payload) => { passedEvents.push(payload); });

      const completed = await taskManager.complete(task.id);
      await verifier.handleCompletion(completed);

      expect(passedEvents).toHaveLength(1);
      expect(passedEvents[0]!.taskId).toBe(task.id);
      expect(passedEvents[0]!.subject).toBe('Event pass');
    });
  });

  describe('handleCompletion - verification fails', () => {
    it('should mark task as failed with verification output', async () => {
      const task = await taskManager.create({
        subject: 'Fail verify',
        description: 'Task with failing verification',
        verifyCommand: 'echo "test error" && exit 1',
      });

      const verifier = new TaskVerifier({ eventBus, taskManager, maxRetries: 3 });

      const completed = await taskManager.complete(task.id);
      await verifier.handleCompletion(completed);

      // After fail() + retry(), the task should be pending (retryCount 0 < maxRetries 3)
      const result = taskManager.get(task.id);
      expect(result!.status).toBe('pending');
      expect(result!.retryCount).toBe(1);
      expect(result!.failureContext).toContain('Verification failed');
      expect(result!.failureContext).toContain('test error');
    });

    it('should emit task:verification_failed event on failure', async () => {
      const task = await taskManager.create({
        subject: 'Event fail',
        description: 'Check failure event',
        verifyCommand: 'echo "bad output" && exit 1',
      });

      const verifier = new TaskVerifier({ eventBus, taskManager });

      const failedEvents: Array<{ taskId: string; subject: string; attempt: number; output: string }> = [];
      eventBus.on('task:verification_failed', (payload) => { failedEvents.push(payload); });

      const completed = await taskManager.complete(task.id);
      await verifier.handleCompletion(completed);

      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0]!.taskId).toBe(task.id);
      expect(failedEvents[0]!.subject).toBe('Event fail');
      expect(failedEvents[0]!.attempt).toBe(1);
      expect(failedEvents[0]!.output).toContain('bad output');
    });

    it('should store verify output in failureContext', async () => {
      const task = await taskManager.create({
        subject: 'Output capture',
        description: 'Capture stderr',
        verifyCommand: 'echo "stdout message" >&2 && exit 1',
      });

      const verifier = new TaskVerifier({ eventBus, taskManager });

      const completed = await taskManager.complete(task.id);
      await verifier.handleCompletion(completed);

      const result = taskManager.get(task.id);
      expect(result!.failureContext).toContain('stdout message');
    });
  });

  describe('handleCompletion - max retries exhausted', () => {
    it('should leave task as failed when retryCount reaches maxRetries', async () => {
      // Create a task that has already been retried 3 times
      const task = await taskManager.create({
        subject: 'Max retries',
        description: 'Exhausted retries',
        verifyCommand: 'false',
      });

      // Simulate previous retries by updating retryCount
      await taskManager.update(task.id, { retryCount: 3 });

      const verifier = new TaskVerifier({ eventBus, taskManager, maxRetries: 3 });

      // Complete the task (simulating a re-attempt after previous retries)
      const completed = await taskManager.complete(task.id);
      await verifier.handleCompletion(completed);

      // Task should be failed (not retried because retryCount >= maxRetries)
      const result = taskManager.get(task.id);
      expect(result!.status).toBe('failed');
      expect(result!.failureContext).toContain('Verification failed');
    });

    it('should still emit task:verification_failed when max retries hit', async () => {
      const task = await taskManager.create({
        subject: 'Max fail event',
        description: 'Event on max retries',
        verifyCommand: 'false',
      });

      await taskManager.update(task.id, { retryCount: 5 });

      const verifier = new TaskVerifier({ eventBus, taskManager, maxRetries: 3 });

      const failedEvents: Array<{ taskId: string; attempt: number }> = [];
      eventBus.on('task:verification_failed', (payload) => { failedEvents.push(payload); });

      const completed = await taskManager.complete(task.id);
      await verifier.handleCompletion(completed);

      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0]!.attempt).toBe(6);
    });
  });

  describe('handleCompletion - timeout', () => {
    it('should treat timeout as verification failure', async () => {
      const task = await taskManager.create({
        subject: 'Timeout verify',
        description: 'Task with slow verification',
        verifyCommand: 'sleep 60',
      });

      // Very short timeout to trigger timeout quickly
      const verifier = new TaskVerifier({
        eventBus,
        taskManager,
        verifyTimeoutMs: 500,
      });

      const completed = await taskManager.complete(task.id);
      await verifier.handleCompletion(completed);

      const result = taskManager.get(task.id);
      // Should be pending (retried) because retryCount (0) < maxRetries (3)
      expect(result!.status).toBe('pending');
      expect(result!.failureContext).toContain('timed out');
    }, 10_000);
  });

  describe('runVerification', () => {
    it('should return exit code 0 for successful command', async () => {
      const verifier = new TaskVerifier({ eventBus, taskManager });

      const result = await verifier.runVerification('echo "success"');
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('success');
    });

    it('should return non-zero exit code for failing command', async () => {
      const verifier = new TaskVerifier({ eventBus, taskManager });

      const result = await verifier.runVerification('echo "fail reason" && exit 1');
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('fail reason');
    });

    it('should capture stderr in output', async () => {
      const verifier = new TaskVerifier({ eventBus, taskManager });

      const result = await verifier.runVerification('echo "stderr message" >&2 && exit 0');
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('stderr message');
    });

    it('should truncate output to 2000 characters', async () => {
      const verifier = new TaskVerifier({ eventBus, taskManager });

      // Generate output longer than 2000 chars
      const result = await verifier.runVerification('python3 -c "print(\'x\' * 3000)"');
      expect(result.output.length).toBeLessThanOrEqual(2000);
    });

    it('should return exit code 124 on timeout', async () => {
      const verifier = new TaskVerifier({
        eventBus,
        taskManager,
        verifyTimeoutMs: 500,
      });

      const result = await verifier.runVerification('sleep 60');
      expect(result.exitCode).toBe(124);
      expect(result.output).toContain('timed out');
    }, 10_000);
  });

  describe('start/stop lifecycle', () => {
    it('should auto-verify tasks when started', async () => {
      const verifier = new TaskVerifier({ eventBus, taskManager });
      verifier.start();

      const passedEvents: Array<{ taskId: string }> = [];
      eventBus.on('task:verification_passed', (payload) => { passedEvents.push(payload); });

      const task = await taskManager.create({
        subject: 'Auto verify',
        description: 'Should be verified on completion',
        verifyCommand: 'true',
      });

      // Completing the task should trigger the verifier via event
      await taskManager.complete(task.id);

      // Wait for async event processing
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(passedEvents).toHaveLength(1);
      expect(passedEvents[0]!.taskId).toBe(task.id);

      verifier.stop();
    });

    it('should not verify tasks after stop', async () => {
      const verifier = new TaskVerifier({ eventBus, taskManager });
      verifier.start();
      verifier.stop();

      const passedEvents: Array<{ taskId: string }> = [];
      eventBus.on('task:verification_passed', (payload) => { passedEvents.push(payload); });

      const task = await taskManager.create({
        subject: 'After stop',
        description: 'Should not be verified',
        verifyCommand: 'true',
      });

      await taskManager.complete(task.id);
      await new Promise(resolve => setTimeout(resolve, 200));

      // No verification should have run
      expect(passedEvents).toHaveLength(0);

      const result = taskManager.get(task.id);
      expect(result!.metadata).not.toHaveProperty('verifyPassed');
    });

    it('should be safe to call start multiple times', () => {
      const verifier = new TaskVerifier({ eventBus, taskManager });
      verifier.start();
      verifier.start();

      // Should only have 1 listener
      expect(eventBus.listenerCount('task:completed')).toBe(1);

      verifier.stop();
    });

    it('should be safe to call stop without start', () => {
      const verifier = new TaskVerifier({ eventBus, taskManager });
      // Should not throw
      verifier.stop();
    });
  });

  describe('integration - retry loop', () => {
    it('should retry a failed verification up to maxRetries then stay failed', async () => {
      const task = await taskManager.create({
        subject: 'Retry loop',
        description: 'Will fail repeatedly',
        verifyCommand: 'false',
      });

      const verifier = new TaskVerifier({ eventBus, taskManager, maxRetries: 2 });

      const failedEvents: Array<{ attempt: number }> = [];
      eventBus.on('task:verification_failed', (payload) => { failedEvents.push(payload); });

      // First attempt: complete -> verify fails -> retried (retryCount 0 < 2)
      const completed1 = await taskManager.complete(task.id);
      await verifier.handleCompletion(completed1);
      let current = taskManager.get(task.id)!;
      expect(current.status).toBe('pending');
      expect(current.retryCount).toBe(1);

      // Second attempt: complete -> verify fails -> retried (retryCount 1 < 2)
      const completed2 = await taskManager.complete(task.id);
      await verifier.handleCompletion(completed2);
      current = taskManager.get(task.id)!;
      expect(current.status).toBe('pending');
      expect(current.retryCount).toBe(2);

      // Third attempt: complete -> verify fails -> maxRetries hit, stays failed
      const completed3 = await taskManager.complete(task.id);
      await verifier.handleCompletion(completed3);
      current = taskManager.get(task.id)!;
      expect(current.status).toBe('failed');
      expect(current.retryCount).toBe(3);

      expect(failedEvents).toHaveLength(3);
      expect(failedEvents[0]!.attempt).toBe(1);
      expect(failedEvents[1]!.attempt).toBe(2);
      expect(failedEvents[2]!.attempt).toBe(3);
    });

    it('should pass verification after a previous failure when command succeeds', async () => {
      // Use a temp file to control pass/fail behavior
      const flagFile = join(testDir, 'verify-flag');
      const task = await taskManager.create({
        subject: 'Conditional pass',
        description: 'Passes when flag file exists',
        verifyCommand: `test -f ${flagFile}`,
      });

      const verifier = new TaskVerifier({ eventBus, taskManager, maxRetries: 3 });

      // First attempt: flag file absent -> fails -> retried
      const completed1 = await taskManager.complete(task.id);
      await verifier.handleCompletion(completed1);
      let current = taskManager.get(task.id)!;
      expect(current.status).toBe('pending');
      expect(current.retryCount).toBe(1);

      // Create the flag file so verification passes
      await Bun.write(flagFile, 'ok');

      // Second attempt: flag file present -> passes
      const completed2 = await taskManager.complete(task.id);
      await verifier.handleCompletion(completed2);
      current = taskManager.get(task.id)!;
      expect(current.status).toBe('completed');
      expect(current.metadata.verifyPassed).toBe(true);
    });
  });
});
