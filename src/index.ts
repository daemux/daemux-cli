/**
 * Universal Autonomous Agent Platform
 * Main entry point exporting all public modules
 */

// Core types
export * from './core/types';

// Core modules
export * from './core';

// Infrastructure
export { Database } from './infra/database';
export type { DatabaseConfig } from './infra/database';

export { Logger, createLogger, getLogger } from './infra/logger';
export type { LoggerConfig } from './infra/logger';

export { MessageQueue, createMessageQueue } from './infra/message-queue';
export type { MessageQueueConfig, IncomingMessage, MessageHandler, QueueStats } from './infra/message-queue';

export { ServiceManager, getServiceManager } from './infra/service';
export type { ServiceConfig, ServiceInfo, ServiceStatus, Platform } from './infra/service';
