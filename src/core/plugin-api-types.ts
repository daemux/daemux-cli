/**
 * Plugin API Type Definitions
 * Types for channels, MCP, memory, hooks, and LLM providers
 */

import type {
  AgentDefinition,
  AgentResult,
  Task,
  TaskStatus,
  LogLevel,
  MemoryEntry,
  ToolDefinition,
} from './types';

// ---------------------------------------------------------------------------
// Channel Interface (4 methods per channel)
// ---------------------------------------------------------------------------

export interface ChannelMessage {
  id: string;
  channelId: string;
  senderId: string;
  senderName?: string;
  content: string;
  attachments?: Array<{
    type: string;
    url?: string;
    data?: Buffer;
  }>;
  replyToId?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ChannelTarget {
  channelId: string;
  userId?: string;
  threadId?: string;
}

export interface Channel {
  id: string;
  type: string;
  connect(config: Record<string, unknown>): Promise<void>;
  disconnect(): Promise<void>;
  send(
    target: ChannelTarget,
    message: string,
    options?: {
      attachments?: Array<{ type: string; data: Buffer; filename: string }>;
      replyToId?: string;
    }
  ): Promise<string>;
  onMessage(handler: (message: ChannelMessage) => Promise<void>): void;
}

// ---------------------------------------------------------------------------
// MCP Interface (Model Context Protocol)
// ---------------------------------------------------------------------------

export type MCPTransport = 'stdio' | 'sse' | 'http' | 'websocket';

export interface MCPServer {
  id: string;
  transport: MCPTransport;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<ToolDefinition[]>;
  callTool(name: string, input: Record<string, unknown>): Promise<unknown>;
  listResources(): Promise<Array<{ uri: string; name: string; mimeType?: string }>>;
  readResource(uri: string): Promise<{ content: string; mimeType?: string }>;
}

export interface MCPConfig {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Memory Provider Interface
// ---------------------------------------------------------------------------

export interface MemoryProvider {
  id: string;
  store(content: string, metadata?: Record<string, unknown>): Promise<string>;
  search(query: string, limit?: number): Promise<MemoryEntry[]>;
  get(id: string): Promise<MemoryEntry | null>;
  delete(id: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Hook Events
// ---------------------------------------------------------------------------

export type HookEvent =
  | 'message'
  | 'agent:start'
  | 'agent:end'
  | 'subagent:spawn'
  | 'startup'
  | 'shutdown'
  | 'preCompact';

export interface HookContext {
  event: HookEvent;
  sessionId: string;
  agentId?: string;
  message?: unknown;
  taskId?: string;
  data?: Record<string, unknown>;
}

export interface HookResult {
  allow: boolean;
  additionalContext?: string;
  error?: string;
}

export type HookHandler = (context: HookContext) => Promise<HookResult>;

// ---------------------------------------------------------------------------
// LLM Provider Interface
// ---------------------------------------------------------------------------

export interface LLMProviderCapabilities {
  streaming: boolean;
  toolUse: boolean;
  vision: boolean;
  maxContextWindow: number;
}

export interface LLMModel {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
}

export interface LLMCredentials {
  type: 'token' | 'api_key';
  value: string;
}

export interface LLMChatOptions {
  model: string;
  messages: Array<{ role: string; content: string | unknown[] }>;
  tools?: ToolDefinition[];
  maxTokens?: number;
  systemPrompt?: string;
}

export interface LLMChatChunk {
  type: 'text' | 'tool_use' | 'done';
  content?: string;
  toolUseId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens';
  usage?: { inputTokens: number; outputTokens: number };
}

export interface LLMChatResponse {
  content: Array<{
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | null;
  usage: { inputTokens: number; outputTokens: number };
}

export interface LLMProvider {
  /** Unique identifier for the provider (e.g., 'anthropic', 'openai') */
  id: string;

  /** Human-readable name for the provider */
  name: string;

  /** Provider capabilities */
  capabilities: LLMProviderCapabilities;

  /**
   * Initialize the provider with credentials
   * Must be called before using other methods
   */
  initialize(credentials: LLMCredentials): Promise<void>;

  /**
   * Check if the provider is ready for use
   */
  isReady(): boolean;

  /**
   * Verify credentials are valid without full initialization
   */
  verifyCredentials(credentials: LLMCredentials): Promise<{ valid: boolean; error?: string }>;

  /**
   * List available models
   */
  listModels(): LLMModel[];

  /**
   * Get the default model ID
   */
  getDefaultModel(): string;

  /**
   * Streaming chat completion
   */
  chat(options: LLMChatOptions): AsyncGenerator<LLMChatChunk>;

  /**
   * Non-streaming chat completion for compaction/summarization
   */
  compactionChat(options: LLMChatOptions): Promise<LLMChatResponse>;

  /**
   * Shutdown and cleanup resources
   */
  shutdown(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Plugin Manifest
// ---------------------------------------------------------------------------

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  main?: string;
  agents?: string | string[];
  commands?: string;
  hooks?: string;
  mcp?: string;
}

// ---------------------------------------------------------------------------
// Plugin API Interface (18 Methods)
// ---------------------------------------------------------------------------

export interface PluginAPI {
  // Registration (5 methods)
  registerChannel(channel: Channel): void;
  registerMCP(id: string, config: MCPConfig): void;
  registerAgent(agent: AgentDefinition): void;
  registerMemory(provider: MemoryProvider): void;
  registerProvider(id: string, provider: LLMProvider): void;

  // Agent Operations (3 methods)
  spawnSubagent(
    agentName: string,
    task: string,
    options?: { timeout?: number; tools?: string[] }
  ): Promise<AgentResult>;
  listAgents(): AgentDefinition[];
  getAgent(name: string): AgentDefinition | undefined;

  // Task Operations (4 methods)
  createTask(task: {
    subject: string;
    description: string;
    activeForm?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Task>;
  updateTask(
    taskId: string,
    updates: {
      status?: TaskStatus;
      subject?: string;
      description?: string;
      activeForm?: string;
      owner?: string;
      addBlocks?: string[];
      addBlockedBy?: string[];
      metadata?: Record<string, unknown>;
    }
  ): Promise<Task>;
  listTasks(filter?: { status?: TaskStatus; owner?: string }): Promise<Task[]>;
  getTask(taskId: string): Promise<Task | null>;

  // Event Hooks (1 method for 7 events)
  on(event: HookEvent, handler: HookHandler): void;

  // Utilities (5 methods)
  sendMessage(channelId: string, target: ChannelTarget, message: string): Promise<string>;
  searchMemory(query: string, options?: { provider?: string; limit?: number }): Promise<MemoryEntry[]>;
  getState<T>(key: string): Promise<T | undefined>;
  setState<T>(key: string, value: T): Promise<void>;
  log(level: LogLevel, message: string, data?: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------
// Plugin Definition
// ---------------------------------------------------------------------------

export interface Plugin {
  manifest: PluginManifest;
  activate?(api: PluginAPI): Promise<void>;
  deactivate?(): Promise<void>;
}
