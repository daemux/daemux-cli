/**
 * MCP Client Type Definitions
 * Package-owned types for the MCP client library
 */

// ---------------------------------------------------------------------------
// Logger Interface (minimal - accepts any compatible logger)
// ---------------------------------------------------------------------------

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ---------------------------------------------------------------------------
// MCP Interfaces
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
  type?: MCPTransport;
  headers?: Record<string, string>;
}
