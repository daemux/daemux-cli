/**
 * Task Manager Unit Tests
 * Tests task lifecycle, dependencies, and status transitions
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { TaskManager, createTaskManager } from '../src/core/task-manager';
import { EventBus } from '../src/core/event-bus';
import { Database } from '../src/infra/database';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';

describe('TaskManager', () => {
  let taskManager: TaskManager;
  let eventBus: EventBus;
  let db: Database;
  const testDbPath = join(import.meta.dir, 'test-task-db.sqlite');

  beforeEach(async () => {
    // Clean up any existing test database
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }

    db = new Database({ path: testDbPath, enableVec: false });
    await db.initialize();

    eventBus = new EventBus();
    taskManager = new TaskManager({ db, eventBus });
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe('Task Creation', () => {
    it('should create a task', async () => {
      const task = await taskManager.create({
        subject: 'Test task',
        description: 'A test task description',
      });

      expect(task.id).toBeDefined();
      expect(task.subject).toBe('Test task');
      expect(task.description).toBe('A test task description');
      expect(task.status).toBe('pending');
    });

    it('should create a task with optional fields', async () => {
      const task = await taskManager.create({
        subject: 'Task with extras',
        description: 'Description',
        activeForm: 'Working on task',
        owner: 'agent-1',
        metadata: { priority: 'high' },
      });

      expect(task.activeForm).toBe('Working on task');
      expect(task.owner).toBe('agent-1');
      expect(task.metadata).toEqual({ priority: 'high' });
    });

    it('should create a task with dependencies', async () => {
      const blocker = await taskManager.create({
        subject: 'Blocker task',
        description: 'This must complete first',
      });

      const blocked = await taskManager.create({
        subject: 'Blocked task',
        description: 'Depends on blocker',
        blockedBy: [blocker.id],
      });

      expect(blocked.blockedBy).toContain(blocker.id);

      // Verify reverse dependency
      const updatedBlocker = taskManager.get(blocker.id);
      expect(updatedBlocker?.blocks).toContain(blocked.id);
    });

    it('should emit task:created event', async () => {
      let emittedTask: any = null;

      eventBus.on('task:created', (payload) => {
        emittedTask = payload.task;
      });

      const task = await taskManager.create({
        subject: 'Event test',
        description: 'Testing events',
      });

      expect(emittedTask).not.toBeNull();
      expect(emittedTask.id).toBe(task.id);
    });
  });

  describe('Task Retrieval', () => {
    it('should get a task by id', async () => {
      const created = await taskManager.create({
        subject: 'Test',
        description: 'Test',
      });

      const retrieved = taskManager.get(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
    });

    it('should return null for non-existent task', () => {
      const retrieved = taskManager.get('non-existent-id');
      expect(retrieved).toBeNull();
    });

    it('should list all tasks', async () => {
      await taskManager.create({ subject: 'Task 1', description: 'Desc 1' });
      await taskManager.create({ subject: 'Task 2', description: 'Desc 2' });
      await taskManager.create({ subject: 'Task 3', description: 'Desc 3' });

      const tasks = taskManager.list();

      expect(tasks.length).toBe(3);
    });

    it('should list tasks by status', async () => {
      await taskManager.create({ subject: 'Pending', description: 'Desc' });
      const inProgress = await taskManager.create({ subject: 'In Progress', description: 'Desc' });
      await taskManager.update(inProgress.id, { status: 'in_progress' });

      const pendingTasks = taskManager.list({ status: 'pending' });
      const inProgressTasks = taskManager.list({ status: 'in_progress' });

      expect(pendingTasks.length).toBe(1);
      expect(inProgressTasks.length).toBe(1);
    });

    it('should list tasks by owner', async () => {
      await taskManager.create({ subject: 'Unowned', description: 'Desc' });
      await taskManager.create({ subject: 'Owned', description: 'Desc', owner: 'agent-1' });

      const ownedTasks = taskManager.list({ owner: 'agent-1' });

      expect(ownedTasks.length).toBe(1);
      expect(ownedTasks[0].subject).toBe('Owned');
    });
  });

  describe('Task Updates', () => {
    it('should update task status', async () => {
      const task = await taskManager.create({
        subject: 'Test',
        description: 'Test',
      });

      const updated = await taskManager.update(task.id, { status: 'in_progress' });

      expect(updated.status).toBe('in_progress');
    });

    it('should update task subject and description', async () => {
      const task = await taskManager.create({
        subject: 'Original',
        description: 'Original description',
      });

      const updated = await taskManager.update(task.id, {
        subject: 'Updated',
        description: 'Updated description',
      });

      expect(updated.subject).toBe('Updated');
      expect(updated.description).toBe('Updated description');
    });

    it('should merge metadata', async () => {
      const task = await taskManager.create({
        subject: 'Test',
        description: 'Test',
        metadata: { key1: 'value1' },
      });

      const updated = await taskManager.update(task.id, {
        metadata: { key2: 'value2' },
      });

      expect(updated.metadata).toEqual({ key1: 'value1', key2: 'value2' });
    });

    it('should emit task:updated event', async () => {
      let emittedPayload: any = null;

      eventBus.on('task:updated', (payload) => {
        emittedPayload = payload;
      });

      const task = await taskManager.create({
        subject: 'Test',
        description: 'Test',
      });

      await taskManager.update(task.id, { status: 'in_progress' });

      expect(emittedPayload).not.toBeNull();
      expect(emittedPayload.changes).toContain('status');
    });

    it('should throw error for non-existent task', async () => {
      await expect(
        taskManager.update('non-existent', { status: 'completed' })
      ).rejects.toThrow();
    });
  });

  describe('Task Dependencies', () => {
    it('should add blockedBy dependency', async () => {
      const task1 = await taskManager.create({ subject: 'Task 1', description: 'Desc' });
      const task2 = await taskManager.create({ subject: 'Task 2', description: 'Desc' });

      await taskManager.update(task2.id, { addBlockedBy: [task1.id] });

      const updated = taskManager.get(task2.id);
      expect(updated?.blockedBy).toContain(task1.id);

      const blocker = taskManager.get(task1.id);
      expect(blocker?.blocks).toContain(task2.id);
    });

    it('should add blocks dependency', async () => {
      const task1 = await taskManager.create({ subject: 'Task 1', description: 'Desc' });
      const task2 = await taskManager.create({ subject: 'Task 2', description: 'Desc' });

      await taskManager.update(task1.id, { addBlocks: [task2.id] });

      const updated = taskManager.get(task1.id);
      expect(updated?.blocks).toContain(task2.id);

      const blocked = taskManager.get(task2.id);
      expect(blocked?.blockedBy).toContain(task1.id);
    });

    it('should remove dependencies', async () => {
      const task1 = await taskManager.create({ subject: 'Task 1', description: 'Desc' });
      const task2 = await taskManager.create({
        subject: 'Task 2',
        description: 'Desc',
        blockedBy: [task1.id],
      });

      await taskManager.update(task2.id, { removeBlockedBy: [task1.id] });

      const updated = taskManager.get(task2.id);
      expect(updated?.blockedBy).not.toContain(task1.id);
    });

    it('should get blocked tasks', async () => {
      const blocker = await taskManager.create({ subject: 'Blocker', description: 'Desc' });
      await taskManager.create({
        subject: 'Blocked',
        description: 'Desc',
        blockedBy: [blocker.id],
      });
      await taskManager.create({ subject: 'Not blocked', description: 'Desc' });

      const blocked = taskManager.getBlocked();

      expect(blocked.length).toBe(1);
      expect(blocked[0].subject).toBe('Blocked');
    });

    it('should emit task:blocked event', async () => {
      let blockedPayload: any = null;

      eventBus.on('task:blocked', (payload) => {
        blockedPayload = payload;
      });

      const blocker = await taskManager.create({ subject: 'Blocker', description: 'Desc' });
      const task = await taskManager.create({ subject: 'Task', description: 'Desc' });

      await taskManager.update(task.id, { addBlockedBy: [blocker.id] });

      expect(blockedPayload).not.toBeNull();
      expect(blockedPayload.blockedBy).toContain(blocker.id);
    });
  });

  describe('Task Claiming', () => {
    it('should claim a task', async () => {
      const task = await taskManager.create({ subject: 'Test', description: 'Desc' });

      const claimed = await taskManager.claim(task.id, 'agent-1');

      expect(claimed.owner).toBe('agent-1');
      expect(claimed.status).toBe('in_progress');
    });

    it('should throw when claiming non-existent task', async () => {
      await expect(
        taskManager.claim('non-existent', 'agent-1')
      ).rejects.toThrow();
    });

    it('should throw when claiming already claimed task', async () => {
      const task = await taskManager.create({ subject: 'Test', description: 'Desc' });

      await taskManager.claim(task.id, 'agent-1');

      await expect(
        taskManager.claim(task.id, 'agent-2')
      ).rejects.toThrow();
    });

    it('should throw when claiming blocked task', async () => {
      const blocker = await taskManager.create({ subject: 'Blocker', description: 'Desc' });
      const blocked = await taskManager.create({
        subject: 'Blocked',
        description: 'Desc',
        blockedBy: [blocker.id],
      });

      await expect(
        taskManager.claim(blocked.id, 'agent-1')
      ).rejects.toThrow(/blocked/);
    });

    it('should allow claiming task with completed blockers', async () => {
      const blocker = await taskManager.create({ subject: 'Blocker', description: 'Desc' });
      const blocked = await taskManager.create({
        subject: 'Blocked',
        description: 'Desc',
        blockedBy: [blocker.id],
      });

      await taskManager.complete(blocker.id);
      const claimed = await taskManager.claim(blocked.id, 'agent-1');

      expect(claimed.owner).toBe('agent-1');
    });
  });

  describe('Task Completion', () => {
    it('should complete a task', async () => {
      const task = await taskManager.create({ subject: 'Test', description: 'Desc' });

      const completed = await taskManager.complete(task.id);

      expect(completed.status).toBe('completed');
    });

    it('should emit task:completed event', async () => {
      let completedPayload: any = null;

      eventBus.on('task:completed', (payload) => {
        completedPayload = payload;
      });

      const task = await taskManager.create({ subject: 'Test', description: 'Desc' });
      await taskManager.complete(task.id);

      expect(completedPayload).not.toBeNull();
      expect(completedPayload.task.status).toBe('completed');
    });

    it('should unblock dependent tasks when completed', async () => {
      const blocker = await taskManager.create({ subject: 'Blocker', description: 'Desc' });
      const blocked = await taskManager.create({
        subject: 'Blocked',
        description: 'Desc',
        blockedBy: [blocker.id],
      });

      await taskManager.complete(blocker.id);

      // Check that blocked task is no longer blocked
      const blockedNow = taskManager.getBlocked();
      expect(blockedNow.find(t => t.id === blocked.id)).toBeUndefined();
    });
  });

  describe('Task Deletion', () => {
    it('should delete a task', async () => {
      const task = await taskManager.create({ subject: 'Test', description: 'Desc' });

      const deleted = await taskManager.delete(task.id);

      expect(deleted).toBe(true);

      const retrieved = taskManager.get(task.id);
      expect(retrieved?.status).toBe('deleted');
    });

    it('should return false for non-existent task', async () => {
      const deleted = await taskManager.delete('non-existent');
      expect(deleted).toBe(false);
    });

    it('should clean up dependencies when deleted', async () => {
      const task1 = await taskManager.create({ subject: 'Task 1', description: 'Desc' });
      const task2 = await taskManager.create({
        subject: 'Task 2',
        description: 'Desc',
        blockedBy: [task1.id],
      });

      await taskManager.delete(task1.id);

      const updated = taskManager.get(task2.id);
      expect(updated?.blockedBy).not.toContain(task1.id);
    });
  });

  describe('Available Tasks', () => {
    it('should get available tasks (pending, not blocked)', async () => {
      await taskManager.create({ subject: 'Available', description: 'Desc' });

      const blocker = await taskManager.create({ subject: 'Blocker', description: 'Desc' });
      await taskManager.create({
        subject: 'Blocked',
        description: 'Desc',
        blockedBy: [blocker.id],
      });

      const inProgress = await taskManager.create({ subject: 'In Progress', description: 'Desc' });
      await taskManager.update(inProgress.id, { status: 'in_progress' });

      const available = taskManager.getAvailable();

      expect(available.length).toBe(2); // Available and Blocker
      expect(available.map(t => t.subject)).toContain('Available');
      expect(available.map(t => t.subject)).toContain('Blocker');
    });

    it('should filter available tasks by owner', async () => {
      await taskManager.create({ subject: 'Unowned', description: 'Desc' });
      await taskManager.create({ subject: 'Owned', description: 'Desc', owner: 'agent-1' });

      const availableForAgent = taskManager.getAvailable('agent-1');
      const availableGeneral = taskManager.getAvailable();

      expect(availableForAgent.length).toBe(2); // Both available for agent-1
      expect(availableGeneral.length).toBe(1); // Only unowned
    });
  });

  describe('In Progress Tasks', () => {
    it('should get in progress tasks', async () => {
      await taskManager.create({ subject: 'Pending', description: 'Desc' });

      const inProgress = await taskManager.create({ subject: 'In Progress', description: 'Desc' });
      await taskManager.update(inProgress.id, { status: 'in_progress', owner: 'agent-1' });

      const tasks = taskManager.getInProgress();

      expect(tasks.length).toBe(1);
      expect(tasks[0].subject).toBe('In Progress');
    });

    it('should filter in progress by owner', async () => {
      const task1 = await taskManager.create({ subject: 'Task 1', description: 'Desc' });
      await taskManager.update(task1.id, { status: 'in_progress', owner: 'agent-1' });

      const task2 = await taskManager.create({ subject: 'Task 2', description: 'Desc' });
      await taskManager.update(task2.id, { status: 'in_progress', owner: 'agent-2' });

      const agent1Tasks = taskManager.getInProgress('agent-1');

      expect(agent1Tasks.length).toBe(1);
      expect(agent1Tasks[0].owner).toBe('agent-1');
    });
  });

  describe('Global Instance', () => {
    it('should create and retrieve global task manager', async () => {
      const created = createTaskManager({ db, eventBus });
      expect(created).toBeInstanceOf(TaskManager);
    });
  });
});
