/**
 * Agentic Loop Types
 */

import type { Message, ToolDefinition, ToolResult, AgentDefinition } from '../types';

// ---------------------------------------------------------------------------
// Loop Configuration
// ---------------------------------------------------------------------------

export interface LoopConfig {
  sessionId?: string;
  agent?: AgentDefinition;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  /** Custom tool executors to register on the ToolExecutor instance */
  toolExecutors?: Map<string, (id: string, input: Record<string, unknown>) => Promise<ToolResult>>;
  maxIterations?: number;
  timeoutMs?: number;
  compactionThreshold?: number;
  onStream?: (chunk: StreamChunk) => void;
  onToolCall?: (name: string, input: Record<string, unknown>) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Stream Chunks
// ---------------------------------------------------------------------------

export type StreamChunk =
  | { type: 'text'; content: string }
  | { type: 'tool_start'; toolUseId: string; name: string }
  | { type: 'tool_input'; toolUseId: string; input: string }
  | { type: 'tool_result'; toolUseId: string; result: string; isError: boolean }
  | { type: 'thinking'; content: string }
  | { type: 'done'; stopReason: string };

// ---------------------------------------------------------------------------
// Loop Result
// ---------------------------------------------------------------------------

export interface LoopResult {
  response: string;
  sessionId: string;
  tokensUsed: {
    input: number;
    output: number;
  };
  toolCalls: Array<{
    name: string;
    input: Record<string, unknown>;
    result: string;
    isError: boolean;
    durationMs: number;
  }>;
  stopReason: 'end_turn' | 'max_tokens' | 'tool_use' | 'timeout';
  durationMs: number;
  compacted: boolean;
}

// ---------------------------------------------------------------------------
// Tool Execution Types
// ---------------------------------------------------------------------------

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ToolCallRecord {
  name: string;
  input: Record<string, unknown>;
  result: string;
  isError: boolean;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// API Message Types
// ---------------------------------------------------------------------------

export interface APIMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | ToolUseBlock
  | ToolResultBlock;

// ---------------------------------------------------------------------------
// API Response Types
// ---------------------------------------------------------------------------

export interface APIResponse {
  id: string;
  content: ContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ---------------------------------------------------------------------------
// Session Context
// ---------------------------------------------------------------------------

export interface SessionContext {
  sessionId: string;
  messages: Message[];
  tokenCount: number;
  compactionCount: number;
}
