/**
 * Database Module - Unified Export
 */

export { DatabaseConnection } from './connection';
export type { DatabaseConfig } from './connection';

export { runMigrations } from './migrations';

export { createSessionsRepository } from './sessions';
export { createMessagesRepository } from './messages';
export { createTasksRepository } from './tasks';
export { createSubagentsRepository } from './subagents';
export { createApprovalsRepository } from './approvals';
export { createSchedulesRepository } from './schedules';
export { createStateRepository } from './state';
export { createMemoryRepository } from './memory';
export { createAuditRepository } from './audit';

export type * from './types';
