/**
 * Core Module - Unified Exports
 * Exports all core components for the Universal Autonomous Agent Platform
 */

// Types
export * from './types';

// Event Bus
export {
  EventBus,
  createEventBus,
  getEventBus,
  type EventMap,
  type EventName,
  type EventPayload,
  type EventHandler,
} from './event-bus';

// Configuration
export {
  ConfigLoader,
  loadConfig,
  getConfig,
  setConfig,
  type ConfigLoaderOptions,
  type SettingsFile,
} from './config';

// State Management
export {
  StateManagerImpl,
  InMemoryStateManager,
  createStateManager,
  getStateManager,
  type StateManager,
  type ScopedState,
} from './state';

// Plugin API Types
export type {
  PluginAPI,
  Plugin,
  PluginManifest,
  Channel,
  ChannelMessage,
  ChannelTarget,
  MCPServer,
  MCPConfig,
  MCPTransport,
  MemoryProvider,
  LLMProvider,
  LLMProviderCapabilities,
  LLMModel,
  LLMCredentials,
  LLMChatOptions,
  LLMChatChunk,
  LLMChatResponse,
  HookEvent,
  HookContext,
  HookResult,
  HookHandler,
  TranscriptionProvider,
  TranscriptionOptions,
  TranscriptionResult,
} from './plugin-api-types';

// Provider Manager
export {
  ProviderManager,
  createProviderManager,
  getProviderManager,
  hasProviderManager,
} from './provider-manager';

// Plugin API Implementation
export {
  createPluginAPI,
  type PluginAPIContext,
} from './plugin-api';

// Plugin Loader
export {
  PluginLoader,
  createPluginLoader,
  getPluginLoader,
  type LoadedPlugin,
} from './plugin-loader';

// Agent Registry
export {
  AgentRegistry,
  createAgentRegistry,
  getAgentRegistry,
} from './agent-registry';

// Task Manager
export {
  TaskManager,
  createTaskManager,
  getTaskManager,
  type TaskCreateInput,
  type TaskUpdateInput,
} from './task-manager';

// Hook Manager
export {
  HookManager,
  createHookManager,
  getHookManager,
} from './hook-manager';

// Approval Manager
export {
  ApprovalManager,
  createApprovalManager,
  getApprovalManager,
} from './approval-manager';

// Heartbeat Manager
export {
  HeartbeatManager,
  createHeartbeatManager,
  getHeartbeatManager,
  type HeartbeatContext,
} from './heartbeat-manager';

// Cron Service
export {
  CronService,
  createCronService,
  getCronService,
  parseExpression,
} from './cron-service';

// Cron Expression Helpers
export {
  calcNextRun,
  recalcNextRunForExisting,
} from './cron-expression';

// Cron Parser
export {
  parseCronExpression,
  nextCronRun,
} from './cron-parser';

// MCP Client
export {
  StdioMCPClient,
  createMCPClient,
} from '@daemux/mcp-client';

// Session Persistence
export {
  SessionPersistence,
  createSessionPersistence,
  type SessionFileInfo,
} from './session-persistence';

// Agentic Loop
export {
  AgenticLoop,
  createAgenticLoop,
  getAgenticLoop,
  ContextBuilder,
  ToolExecutor,
  BUILTIN_TOOLS,
  registerToolExecutor,
  type LoopConfig,
  type LoopResult,
  type StreamChunk,
  type ToolUseBlock,
  type ToolResultBlock,
  type ToolCallRecord,
  type SessionContext,
} from './loop';

// Enhanced Channel Types
export {
  ChannelMessageTypeSchema,
  ChannelAttachmentSchema,
  RichChannelMessageSchema,
  ChannelSendOptionsSchema,
  type ChannelMessageType,
  type ChannelAttachment,
  type RichChannelMessage,
  type ChannelSendOptions,
  type ChannelEventType,
  type ChannelEventHandler,
  type EnhancedChannel,
} from './channel-types';

// Channel Formatting
export {
  plainTextFormatter,
  type ChannelFormatter,
} from './channel-format';

// Channel Manager
export {
  ChannelManager,
  createChannelManager,
  getChannelManager,
} from './channel-manager';

// Channel Router
export {
  ChannelRouter,
  createChannelRouter,
  getChannelRouter,
  type ChannelRouterOptions,
} from './channel-router';

// Chat Session
export {
  ChatSession,
} from './chat-session';

// Background Task Runner
export {
  BackgroundTaskRunner,
  type TaskInfo,
  type TaskStatus as BackgroundTaskStatus,
  type SpawnResult,
} from './background-task-runner';

// Dialog Tools
export {
  DIALOG_TOOLS,
  createDialogToolExecutors,
} from './dialog-tools';

// Task Verifier
export {
  TaskVerifier,
  createTaskVerifier,
  getTaskVerifier,
  type TaskVerifierOptions,
  type VerifyResult,
} from './task-verifier';

// Work Loop
export {
  WorkLoop,
  createWorkLoop,
  getWorkLoop,
  type WorkLoopOptions,
} from './work-loop';

// Retry Prompt
export {
  buildRetryPrompt,
} from './retry-prompt';

// Error Classification
export {
  classifyError,
} from './error-classify';

// MCP Environment Expansion
export {
  expandEnvValue,
  expandEnvInRecord,
  expandMCPConfig,
} from './mcp/env-expand';

// MCP Config Loading
export {
  loadMCPConfigs,
  loadFromSettings,
  loadFromProjectMcpJson,
} from './mcp/config-loader';
