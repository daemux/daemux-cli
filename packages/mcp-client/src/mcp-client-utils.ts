/**
 * MCP Client Utilities
 * JSON-RPC types, subprocess handle, and content parsing helpers
 */

import type { ToolDefinition } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PROTOCOL_VERSION = '2024-11-05';
export const DEFAULT_TIMEOUT_MS = 30_000;
export const JSONRPC_VERSION = '2.0';

// ---------------------------------------------------------------------------
// JSON-RPC Types
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: typeof JSONRPC_VERSION;
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: typeof JSONRPC_VERSION;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// Subprocess Handle (typed for pipe mode)
// ---------------------------------------------------------------------------

export interface SubprocessHandle {
  stdin: import('bun').FileSink;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(): void;
}

// ---------------------------------------------------------------------------
// MCP Response Types
// ---------------------------------------------------------------------------

export interface ToolsListResult {
  tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
}

export interface ToolCallResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export interface ResourcesListResult {
  resources?: Array<{ uri: string; name: string; mimeType?: string }>;
}

export interface ResourceReadResult {
  contents?: Array<{ uri: string; text?: string; blob?: string; mimeType?: string }>;
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

function normalizeInputSchema(schema: unknown): ToolDefinition['inputSchema'] {
  if (schema && typeof schema === 'object' && 'type' in schema) {
    const s = schema as Record<string, unknown>;
    return {
      type: 'object' as const,
      properties: (s.properties as Record<string, unknown>) ?? {},
      required: Array.isArray(s.required) ? (s.required as string[]) : undefined,
    };
  }

  return { type: 'object' as const, properties: {} };
}

// ---------------------------------------------------------------------------
// Shared MCP Response Handlers
// ---------------------------------------------------------------------------

export function mapToolsList(result: ToolsListResult): ToolDefinition[] {
  return (result.tools ?? []).map(tool => ({
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: normalizeInputSchema(tool.inputSchema),
  }));
}

export function handleToolCallResult(name: string, result: ToolCallResult): unknown {
  const content = result.content;

  if (result.isError) {
    const errorText = content?.filter(c => c.type === 'text' && c.text).map(c => c.text!).join('\n');
    throw new Error(`MCP tool '${name}' failed: ${errorText || 'Unknown error'}`);
  }

  if (!content || content.length === 0) return null;
  const texts = content.filter(c => c.type === 'text' && c.text);
  if (texts.length === 1) return texts[0]!.text;
  if (texts.length > 1) return texts.map(c => c.text).join('\n');
  return content;
}

export function mapResourcesList(
  result: ResourcesListResult
): Array<{ uri: string; name: string; mimeType?: string }> {
  return (result.resources ?? []).map(r => ({ uri: r.uri, name: r.name, mimeType: r.mimeType }));
}

export function handleResourceReadResult(
  uri: string,
  result: ResourceReadResult
): { content: string; mimeType?: string } {
  const first = result.contents?.[0];
  if (!first) throw new Error(`MCP resource '${uri}' returned no content`);
  return {
    content: first.text ?? (first.blob ? atob(first.blob) : ''),
    mimeType: first.mimeType,
  };
}

export function buildInitializeParams(): Record<string, unknown> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { tools: {}, resources: {} },
    clientInfo: { name: 'daemux', version: '1.0.0' },
  };
}

export function clearPendingRequests(pending: Map<number, PendingRequest>, reason: string): void {
  for (const entry of pending.values()) {
    clearTimeout(entry.timeout);
    entry.reject(new Error(reason));
  }
  pending.clear();
}

export function resolveJsonRpcResponse(
  pending: Map<number, PendingRequest>,
  parsed: JsonRpcResponse
): void {
  if (parsed.id === undefined || parsed.id === null) return;

  const entry = pending.get(parsed.id);
  if (!entry) return;

  pending.delete(parsed.id);
  clearTimeout(entry.timeout);

  if (parsed.error) {
    entry.reject(new Error(`MCP error (${parsed.error.code}): ${parsed.error.message}`));
  } else {
    entry.resolve(parsed.result);
  }
}

// ---------------------------------------------------------------------------
// Subprocess Spawn
// ---------------------------------------------------------------------------

/**
 * Spawn a subprocess with typed pipe handles for stdin/stdout/stderr
 */
export function spawnMCPProcess(
  command: string,
  args: string[],
  env: Record<string, string | undefined>
): SubprocessHandle {
  const spawned = Bun.spawn([command, ...args], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env,
  });

  return {
    stdin: spawned.stdin as import('bun').FileSink,
    stdout: spawned.stdout as ReadableStream<Uint8Array>,
    stderr: spawned.stderr as ReadableStream<Uint8Array>,
    exited: spawned.exited,
    kill: () => spawned.kill(),
  };
}
