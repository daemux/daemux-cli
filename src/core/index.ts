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
