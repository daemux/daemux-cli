/**
 * Task Manager - Workflow Task Tracking with Dependencies
 * Manages task lifecycle, dependencies, and status transitions
 */

import type { Task, TaskStatus } from './types';
import type { Database } from '../infra/database';
import type { EventBus } from './event-bus';
import { getLogger } from '../infra/logger';

// ---------------------------------------------------------------------------
// Task Creation Input
// ---------------------------------------------------------------------------

export interface TaskCreateInput {
  subject: string;
  description: string;
  activeForm?: string;
  owner?: string;
  metadata?: Record<string, unknown>;
  blockedBy?: string[];
  timeBudgetMs?: number;
  verifyCommand?: string;
}

// ---------------------------------------------------------------------------
// Task Update Input
// ---------------------------------------------------------------------------

export interface TaskUpdateInput {
  status?: TaskStatus;
  subject?: string;
  description?: string;
  activeForm?: string;
  owner?: string;
  clearOwner?: boolean;
  addBlocks?: string[];
  addBlockedBy?: string[];
  removeBlocks?: string[];
  removeBlockedBy?: string[];
  metadata?: Record<string, unknown>;
  failureContext?: string;
  retryCount?: number;
}

// ---------------------------------------------------------------------------
// Task Manager Class
// ---------------------------------------------------------------------------

export class TaskManager {
  private db: Database;
  private eventBus: EventBus;

  constructor(options: { db: Database; eventBus: EventBus }) {
    this.db = options.db;
    this.eventBus = options.eventBus;
  }

  /**
   * Create a new task
   */
  async create(input: TaskCreateInput): Promise<Task> {
    const task = this.db.tasks.create({
      subject: input.subject,
      description: input.description,
      activeForm: input.activeForm,
      status: 'pending',
      owner: input.owner,
      blockedBy: input.blockedBy ?? [],
      blocks: [],
      metadata: input.metadata ?? {},
      timeBudgetMs: input.timeBudgetMs,
      verifyCommand: input.verifyCommand,
      retryCount: 0,
    });

    // Update reverse dependencies (blocks)
    if (input.blockedBy) {
      for (const blockerId of input.blockedBy) {
        const blocker = this.db.tasks.get(blockerId);
        if (blocker) {
          this.db.tasks.update(blockerId, {
            blocks: [...blocker.blocks, task.id],
          });
        }
      }
    }

    await this.eventBus.emit('task:created', { task });

    getLogger().info(`Task created: ${task.subject}`, {
      id: task.id,
      blockedBy: task.blockedBy,
    });

    return task;
  }

  /**
   * Update an existing task
   */
  async update(id: string, input: TaskUpdateInput): Promise<Task> {
    const existing = this.db.tasks.get(id);
    if (!existing) {
      throw new Error(`Task ${id} not found`);
    }

    const changes: string[] = [];
    const updates: Partial<Task> = {};

    this.applyFieldUpdates(input, existing, id, updates, changes);
    this.applyDependencyChanges(input, existing, id, updates, changes);

    const task = this.db.tasks.update(id, updates);

    if (changes.length > 0) {
      await this.eventBus.emit('task:updated', { task, changes });
    }

    await this.emitLifecycleEvents(input, existing, task, id);

    getLogger().debug(`Task updated: ${task.subject}`, { id, changes });
    return task;
  }

  /**
   * Get a task by ID
   */
  get(id: string): Task | null {
    return this.db.tasks.get(id);
  }

  /**
   * List tasks with optional filtering
   */
  list(filter?: {
    status?: TaskStatus;
    owner?: string;
    notBlocked?: boolean;
  }): Task[] {
    return this.db.tasks.list(filter);
  }

  /**
   * Delete a task (soft delete - marks as deleted)
   */
  async delete(id: string): Promise<boolean> {
    const task = this.db.tasks.get(id);
    if (!task) return false;

    this.removeReverseDeps(id, task.blockedBy, 'blocks');
    this.removeReverseDeps(id, task.blocks, 'blockedBy');

    return this.db.tasks.delete(id);
  }

  /**
   * Get tasks that are ready to work on (pending, not blocked)
   */
  getAvailable(owner?: string): Task[] {
    const tasks = this.list({ status: 'pending', notBlocked: true });
    if (owner) {
      return tasks.filter(t => !t.owner || t.owner === owner);
    }
    return tasks.filter(t => !t.owner);
  }

  /**
   * Get tasks that are blocked
   */
  getBlocked(): Task[] {
    return this.db.tasks.getBlocked();
  }

  /**
   * Get tasks currently in progress
   */
  getInProgress(owner?: string): Task[] {
    const tasks = this.list({ status: 'in_progress' });
    if (owner) {
      return tasks.filter(t => t.owner === owner);
    }
    return tasks;
  }

  /**
   * Claim a task for an owner
   */
  async claim(id: string, owner: string): Promise<Task> {
    const task = this.db.tasks.get(id);
    if (!task) {
      throw new Error(`Task ${id} not found`);
    }

    if (task.owner && task.owner !== owner) {
      throw new Error(`Task ${id} is already claimed by ${task.owner}`);
    }

    if (task.blockedBy.length > 0) {
      const activeBlockers = task.blockedBy.filter(blockerId => {
        const blocker = this.db.tasks.get(blockerId);
        return blocker && blocker.status !== 'completed';
      });

      if (activeBlockers.length > 0) {
        throw new Error(`Task ${id} is blocked by: ${activeBlockers.join(', ')}`);
      }
    }

    return this.update(id, { owner, status: 'in_progress' });
  }

  /**
   * Complete a task
   */
  async complete(id: string): Promise<Task> {
    return this.update(id, { status: 'completed' });
  }

  /**
   * Mark a task as failed with error context
   */
  async fail(id: string, errorMessage: string): Promise<Task> {
    const existing = this.get(id);
    if (!existing) throw new Error(`Task ${id} not found`);
    return this.update(id, {
      status: 'failed',
      failureContext: errorMessage.slice(0, 2000),
      retryCount: (existing.retryCount ?? 0) + 1,
    });
  }

  /**
   * Retry a failed task by resetting to pending
   */
  async retry(id: string): Promise<Task> {
    const existing = this.get(id);
    if (!existing) throw new Error(`Task ${id} not found`);
    if (existing.status !== 'failed') {
      throw new Error(`Task ${id} is not in failed status`);
    }
    return this.update(id, { status: 'pending', clearOwner: true });
  }

  // -------------------------------------------------------------------------
  // Private: Field and dependency update helpers
  // -------------------------------------------------------------------------

  private applyFieldUpdates(
    input: TaskUpdateInput, existing: Task, id: string,
    updates: Partial<Task>, changes: string[],
  ): void {
    if (input.status !== undefined && input.status !== existing.status) {
      updates.status = input.status;
      changes.push('status');
    }
    if (input.subject !== undefined) { updates.subject = input.subject; changes.push('subject'); }
    if (input.description !== undefined) { updates.description = input.description; changes.push('description'); }
    if (input.activeForm !== undefined) { updates.activeForm = input.activeForm; changes.push('activeForm'); }

    if (input.clearOwner) {
      this.db.tasks.clearOwner(id);
      changes.push('owner');
    } else if (input.owner !== undefined) {
      updates.owner = input.owner;
      changes.push('owner');
    }

    if (input.metadata !== undefined) {
      updates.metadata = { ...existing.metadata, ...input.metadata };
      changes.push('metadata');
    }
    if (input.failureContext !== undefined) { updates.failureContext = input.failureContext; changes.push('failureContext'); }
    if (input.retryCount !== undefined) { updates.retryCount = input.retryCount; changes.push('retryCount'); }
  }

  private applyDependencyChanges(
    input: TaskUpdateInput, existing: Task, id: string,
    updates: Partial<Task>, changes: string[],
  ): void {
    if (input.addBlockedBy?.length) {
      updates.blockedBy = [...new Set([...existing.blockedBy, ...input.addBlockedBy])];
      changes.push('blockedBy');
      this.addReverseDeps(id, input.addBlockedBy, existing.blockedBy, 'blocks');
    }

    if (input.addBlocks?.length) {
      updates.blocks = [...new Set([...existing.blocks, ...input.addBlocks])];
      changes.push('blocks');
      this.addReverseDeps(id, input.addBlocks, existing.blocks, 'blockedBy');
    }

    if (input.removeBlockedBy?.length) {
      updates.blockedBy = existing.blockedBy.filter(b => !input.removeBlockedBy!.includes(b));
      changes.push('blockedBy');
      this.removeReverseDeps(id, input.removeBlockedBy, 'blocks');
    }

    if (input.removeBlocks?.length) {
      updates.blocks = existing.blocks.filter(b => !input.removeBlocks!.includes(b));
      changes.push('blocks');
      this.removeReverseDeps(id, input.removeBlocks, 'blockedBy');
    }
  }

  private async emitLifecycleEvents(
    input: TaskUpdateInput, existing: Task, task: Task, id: string,
  ): Promise<void> {
    if (input.status === 'completed' && existing.status !== 'completed') {
      await this.eventBus.emit('task:completed', { task });
      await this.checkUnblockedTasks(id);
    }

    if (task.blockedBy.length > 0 && existing.blockedBy.length === 0) {
      await this.eventBus.emit('task:blocked', { task, blockedBy: task.blockedBy });
    }
  }

  /**
   * Add reverse dependency links. For each targetId not already in existingIds,
   * appends `id` to the target's `reverseField` array.
   */
  private addReverseDeps(
    id: string, targetIds: string[], existingIds: string[], reverseField: 'blocks' | 'blockedBy',
  ): void {
    for (const targetId of targetIds) {
      if (existingIds.includes(targetId)) continue;
      const target = this.db.tasks.get(targetId);
      if (target && !target[reverseField].includes(id)) {
        this.db.tasks.update(targetId, { [reverseField]: [...target[reverseField], id] });
      }
    }
  }

  /**
   * Remove `id` from each target's `reverseField` array.
   */
  private removeReverseDeps(
    id: string, targetIds: string[], reverseField: 'blocks' | 'blockedBy',
  ): void {
    for (const targetId of targetIds) {
      const target = this.db.tasks.get(targetId);
      if (target) {
        this.db.tasks.update(targetId, { [reverseField]: target[reverseField].filter(b => b !== id) });
      }
    }
  }

  /**
   * Check if any tasks became unblocked after a task completion
   */
  private async checkUnblockedTasks(completedTaskId: string): Promise<void> {
    const blocked = this.getBlocked();

    for (const task of blocked) {
      if (!task.blockedBy.includes(completedTaskId)) continue;

      // Check if all blockers are now completed
      const stillBlocked = task.blockedBy.some(blockerId => {
        const blocker = this.db.tasks.get(blockerId);
        return blocker && blocker.status !== 'completed';
      });

      if (!stillBlocked) {
        // Remove completed blocker from list
        const newBlockedBy = task.blockedBy.filter(b => {
          const blocker = this.db.tasks.get(b);
          return blocker && blocker.status !== 'completed';
        });

        this.db.tasks.update(task.id, { blockedBy: newBlockedBy });

        getLogger().info(`Task unblocked: ${task.subject}`, {
          id: task.id,
          unblockedBy: completedTaskId,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Global Task Manager Instance
// ---------------------------------------------------------------------------

let globalTaskManager: TaskManager | null = null;

export function createTaskManager(options: { db: Database; eventBus: EventBus }): TaskManager {
  globalTaskManager = new TaskManager(options);
  return globalTaskManager;
}

export function getTaskManager(): TaskManager {
  if (!globalTaskManager) {
    throw new Error('Task manager not initialized. Call createTaskManager first.');
  }
  return globalTaskManager;
}
