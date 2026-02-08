/**
 * Tasks Repository
 */

import type { Database as BunSQLite, SQLQueryBindings } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import type { Task } from '../../core/types';
import type { TaskRow } from './types';

type SQLBindings = SQLQueryBindings[];

export function createTasksRepository(db: BunSQLite) {
  const mapRow = (row: TaskRow): Task => ({
    id: row.id,
    subject: row.subject,
    description: row.description,
    activeForm: row.active_form ?? undefined,
    status: row.status as Task['status'],
    owner: row.owner ?? undefined,
    blockedBy: JSON.parse(row.blocked_by || '[]'),
    blocks: JSON.parse(row.blocks || '[]'),
    metadata: JSON.parse(row.metadata || '{}'),
    timeBudgetMs: row.time_budget_ms ?? undefined,
    verifyCommand: row.verify_command ?? undefined,
    failureContext: row.failure_context ?? undefined,
    retryCount: row.retry_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

  const repo = {
    create: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Task => {
      const id = randomUUID();
      const now = Date.now();

      db.run(
        `INSERT INTO tasks (id, subject, description, active_form, status, owner, blocked_by, blocks, metadata, time_budget_ms, verify_command, failure_context, retry_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          task.subject,
          task.description,
          task.activeForm ?? null,
          task.status ?? 'pending',
          task.owner ?? null,
          JSON.stringify(task.blockedBy ?? []),
          JSON.stringify(task.blocks ?? []),
          JSON.stringify(task.metadata ?? {}),
          task.timeBudgetMs ?? null,
          task.verifyCommand ?? null,
          task.failureContext ?? null,
          task.retryCount ?? 0,
          now,
          now,
        ]
      );

      return {
        id,
        ...task,
        status: task.status ?? 'pending',
        blockedBy: task.blockedBy ?? [],
        blocks: task.blocks ?? [],
        metadata: task.metadata ?? {},
        retryCount: task.retryCount ?? 0,
        createdAt: now,
        updatedAt: now,
      };
    },

    get: (id: string): Task | null => {
      const row = db.query('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | null;
      return row ? mapRow(row) : null;
    },

    update: function(id: string, updates: Partial<Task>): Task {
      const fields: string[] = ['updated_at = ?'];
      const values: SQLQueryBindings[] = [Date.now()];

      if (updates.subject !== undefined) {
        fields.push('subject = ?');
        values.push(updates.subject);
      }
      if (updates.description !== undefined) {
        fields.push('description = ?');
        values.push(updates.description);
      }
      if (updates.activeForm !== undefined) {
        fields.push('active_form = ?');
        values.push(updates.activeForm);
      }
      if (updates.status !== undefined) {
        fields.push('status = ?');
        values.push(updates.status);
      }
      if (updates.owner !== undefined) {
        fields.push('owner = ?');
        values.push(updates.owner);
      }
      if (updates.blockedBy !== undefined) {
        fields.push('blocked_by = ?');
        values.push(JSON.stringify(updates.blockedBy));
      }
      if (updates.blocks !== undefined) {
        fields.push('blocks = ?');
        values.push(JSON.stringify(updates.blocks));
      }
      if (updates.metadata !== undefined) {
        fields.push('metadata = ?');
        values.push(JSON.stringify(updates.metadata));
      }
      if (updates.timeBudgetMs !== undefined) {
        fields.push('time_budget_ms = ?');
        values.push(updates.timeBudgetMs);
      }
      if (updates.verifyCommand !== undefined) {
        fields.push('verify_command = ?');
        values.push(updates.verifyCommand);
      }
      if (updates.failureContext !== undefined) {
        fields.push('failure_context = ?');
        values.push(updates.failureContext);
      }
      if (updates.retryCount !== undefined) {
        fields.push('retry_count = ?');
        values.push(updates.retryCount);
      }

      values.push(id);
      db.run(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, values as SQLBindings);

      const task = this.get(id);
      if (!task) throw new Error(`Task ${id} not found`);
      return task;
    },

    list: (filter?: { status?: string; owner?: string; notBlocked?: boolean }): Task[] => {
      let query = 'SELECT * FROM tasks WHERE 1=1';
      const params: SQLQueryBindings[] = [];

      if (filter?.status) {
        query += ' AND status = ?';
        params.push(filter.status);
      }
      if (filter?.owner) {
        query += ' AND owner = ?';
        params.push(filter.owner);
      }
      if (filter?.notBlocked) {
        query += " AND (blocked_by = '[]' OR blocked_by IS NULL)";
      }

      query += ' ORDER BY created_at ASC';
      const rows = db.query(query).all(...(params as SQLBindings)) as TaskRow[];
      return rows.map(mapRow);
    },

    delete: (id: string): boolean => {
      const result = db.run("UPDATE tasks SET status = 'deleted', updated_at = ? WHERE id = ?", [Date.now(), id]);
      return result.changes > 0;
    },

    addDependency: function(taskId: string, blockedBy: string): void {
      const task = this.get(taskId);
      if (!task) throw new Error(`Task ${taskId} not found`);

      const dependencies = [...task.blockedBy, blockedBy];
      this.update(taskId, { blockedBy: dependencies });

      const blocker = this.get(blockedBy);
      if (blocker) {
        const blocks = [...blocker.blocks, taskId];
        this.update(blockedBy, { blocks });
      }
    },

    removeDependency: function(taskId: string, blockedBy: string): void {
      const task = this.get(taskId);
      if (!task) throw new Error(`Task ${taskId} not found`);

      const dependencies = task.blockedBy.filter(id => id !== blockedBy);
      this.update(taskId, { blockedBy: dependencies });

      const blocker = this.get(blockedBy);
      if (blocker) {
        const blocks = blocker.blocks.filter(id => id !== taskId);
        this.update(blockedBy, { blocks });
      }
    },

    clearOwner: (id: string): void => {
      db.run('UPDATE tasks SET owner = NULL, updated_at = ? WHERE id = ?', [Date.now(), id]);
    },

    getBlocked: (): Task[] => {
      const rows = db.query(
        "SELECT * FROM tasks WHERE blocked_by != '[]' AND status != 'deleted'"
      ).all() as TaskRow[];
      return rows.map(mapRow);
    },
  };

  return repo;
}
