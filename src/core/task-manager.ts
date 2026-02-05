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
  addBlocks?: string[];
  addBlockedBy?: string[];
  removeBlocks?: string[];
  removeBlockedBy?: string[];
  metadata?: Record<string, unknown>;
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

    // Basic field updates
    if (input.status !== undefined && input.status !== existing.status) {
      updates.status = input.status;
      changes.push('status');
    }
    if (input.subject !== undefined) {
      updates.subject = input.subject;
      changes.push('subject');
    }
    if (input.description !== undefined) {
      updates.description = input.description;
      changes.push('description');
    }
    if (input.activeForm !== undefined) {
      updates.activeForm = input.activeForm;
      changes.push('activeForm');
    }
    if (input.owner !== undefined) {
      updates.owner = input.owner;
      changes.push('owner');
    }
    if (input.metadata !== undefined) {
      updates.metadata = { ...existing.metadata, ...input.metadata };
      changes.push('metadata');
    }

    // Handle dependency additions
    if (input.addBlockedBy && input.addBlockedBy.length > 0) {
      const newBlockedBy = [...new Set([...existing.blockedBy, ...input.addBlockedBy])];
      updates.blockedBy = newBlockedBy;
      changes.push('blockedBy');

      // Update reverse dependencies
      for (const blockerId of input.addBlockedBy) {
        if (!existing.blockedBy.includes(blockerId)) {
          const blocker = this.db.tasks.get(blockerId);
          if (blocker && !blocker.blocks.includes(id)) {
            this.db.tasks.update(blockerId, {
              blocks: [...blocker.blocks, id],
            });
          }
        }
      }
    }

    if (input.addBlocks && input.addBlocks.length > 0) {
      const newBlocks = [...new Set([...existing.blocks, ...input.addBlocks])];
      updates.blocks = newBlocks;
      changes.push('blocks');

      // Update reverse dependencies
      for (const blockedId of input.addBlocks) {
        if (!existing.blocks.includes(blockedId)) {
          const blocked = this.db.tasks.get(blockedId);
          if (blocked && !blocked.blockedBy.includes(id)) {
            this.db.tasks.update(blockedId, {
              blockedBy: [...blocked.blockedBy, id],
            });
          }
        }
      }
    }

    // Handle dependency removals
    if (input.removeBlockedBy && input.removeBlockedBy.length > 0) {
      const newBlockedBy = existing.blockedBy.filter(
        b => !input.removeBlockedBy!.includes(b)
      );
      updates.blockedBy = newBlockedBy;
      changes.push('blockedBy');

      // Update reverse dependencies
      for (const blockerId of input.removeBlockedBy) {
        const blocker = this.db.tasks.get(blockerId);
        if (blocker) {
          this.db.tasks.update(blockerId, {
            blocks: blocker.blocks.filter(b => b !== id),
          });
        }
      }
    }

    if (input.removeBlocks && input.removeBlocks.length > 0) {
      const newBlocks = existing.blocks.filter(
        b => !input.removeBlocks!.includes(b)
      );
      updates.blocks = newBlocks;
      changes.push('blocks');

      // Update reverse dependencies
      for (const blockedId of input.removeBlocks) {
        const blocked = this.db.tasks.get(blockedId);
        if (blocked) {
          this.db.tasks.update(blockedId, {
            blockedBy: blocked.blockedBy.filter(b => b !== id),
          });
        }
      }
    }

    // Apply updates
    const task = this.db.tasks.update(id, updates);

    if (changes.length > 0) {
      await this.eventBus.emit('task:updated', { task, changes });
    }

    // Emit completion event
    if (input.status === 'completed' && existing.status !== 'completed') {
      await this.eventBus.emit('task:completed', { task });
      await this.checkUnblockedTasks(id);
    }

    // Emit blocked event if newly blocked
    if (task.blockedBy.length > 0 && existing.blockedBy.length === 0) {
      await this.eventBus.emit('task:blocked', {
        task,
        blockedBy: task.blockedBy,
      });
    }

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

    // Remove from other tasks' dependencies
    for (const blockerId of task.blockedBy) {
      const blocker = this.db.tasks.get(blockerId);
      if (blocker) {
        this.db.tasks.update(blockerId, {
          blocks: blocker.blocks.filter(b => b !== id),
        });
      }
    }

    for (const blockedId of task.blocks) {
      const blocked = this.db.tasks.get(blockedId);
      if (blocked) {
        this.db.tasks.update(blockedId, {
          blockedBy: blocked.blockedBy.filter(b => b !== id),
        });
      }
    }

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

export function createTaskManager(options: {
  db: Database;
  eventBus: EventBus;
}): TaskManager {
  globalTaskManager = new TaskManager(options);
  return globalTaskManager;
}

export function getTaskManager(): TaskManager {
  if (!globalTaskManager) {
    throw new Error('Task manager not initialized. Call createTaskManager first.');
  }
  return globalTaskManager;
}
