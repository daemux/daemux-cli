/**
 * SQLite Database Abstraction with Auto-Migration
 * Facade that combines all repository modules
 */

import { DatabaseConnection, runMigrations } from './db';
import { createSessionsRepository } from './db/sessions';
import { createMessagesRepository } from './db/messages';
import { createTasksRepository } from './db/tasks';
import { createSubagentsRepository } from './db/subagents';
import { createApprovalsRepository } from './db/approvals';
import { createSchedulesRepository } from './db/schedules';
import { createStateRepository } from './db/state';
import { createMemoryRepository } from './db/memory';
import { createAuditRepository } from './db/audit';

export type { DatabaseConfig } from './db/connection';

export class Database {
  private connection: DatabaseConnection;

  readonly sessions: ReturnType<typeof createSessionsRepository>;
  readonly messages: ReturnType<typeof createMessagesRepository>;
  readonly tasks: ReturnType<typeof createTasksRepository>;
  readonly subagents: ReturnType<typeof createSubagentsRepository>;
  readonly approvals: ReturnType<typeof createApprovalsRepository>;
  readonly schedules: ReturnType<typeof createSchedulesRepository>;
  readonly state: ReturnType<typeof createStateRepository>;
  readonly memory: ReturnType<typeof createMemoryRepository>;
  readonly audit: ReturnType<typeof createAuditRepository>;

  constructor(config: { path: string; enableVec?: boolean }) {
    this.connection = new DatabaseConnection(config);

    const db = this.connection.raw;
    const vecEnabled = this.connection.hasVec;

    this.sessions = createSessionsRepository(db);
    this.messages = createMessagesRepository(db);
    this.tasks = createTasksRepository(db);
    this.subagents = createSubagentsRepository(db);
    this.approvals = createApprovalsRepository(db);
    this.schedules = createSchedulesRepository(db);
    this.state = createStateRepository(db);
    this.memory = createMemoryRepository(db, vecEnabled);
    this.audit = createAuditRepository(db);
  }

  async initialize(): Promise<void> {
    runMigrations(this.connection.raw, this.connection.hasVec);
  }

  close(): void {
    this.connection.close();
  }

  async checkIntegrity(): Promise<boolean> {
    return this.connection.checkIntegrity();
  }
}
