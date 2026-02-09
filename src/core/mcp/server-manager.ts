/**
 * MCP Server Manager
 *
 * Central lifecycle manager for MCP server connections.
 * Connects to MCP servers, discovers their tools, and routes tool calls.
 */

import type { MCPServer, MCPConfig, MCPTransport, ToolDefinition } from '@daemux/mcp-client';
import { createMCPClient as defaultCreateMCPClient } from '@daemux/mcp-client';
import { expandMCPConfig as defaultExpandMCPConfig } from './env-expand';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

type CreateMCPClientFn = (id: string, transport: MCPTransport, config: MCPConfig) => MCPServer;
type ExpandMCPConfigFn = (config: MCPConfig) => MCPConfig;

export interface MCPServerManagerDeps {
  createMCPClient?: CreateMCPClientFn;
  expandMCPConfig?: ExpandMCPConfigFn;
}

interface ConnectedServer {
  server: MCPServer;
  tools: ToolDefinition[];
}

export interface ConnectAllResult {
  connected: string[];
  failed: Array<{ id: string; error: string }>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// MCPServerManager
// ---------------------------------------------------------------------------

export class MCPServerManager {
  private readonly log: Logger;
  private readonly servers = new Map<string, ConnectedServer>();
  private readonly createClient: CreateMCPClientFn;
  private readonly expandConfig: ExpandMCPConfigFn;

  constructor(logger: Logger, deps?: MCPServerManagerDeps) {
    this.log = logger;
    this.createClient = deps?.createMCPClient ?? defaultCreateMCPClient;
    this.expandConfig = deps?.expandMCPConfig ?? defaultExpandMCPConfig;
  }

  /**
   * Connects to all configured MCP servers in parallel.
   * Returns which servers connected successfully and which failed.
   */
  async connectAll(configs: Record<string, MCPConfig>): Promise<ConnectAllResult> {
    const entries = Object.entries(configs);
    if (entries.length === 0) {
      return { connected: [], failed: [] };
    }

    const results = await Promise.allSettled(
      entries.map(([id, config]) => this.connectServer(id, config).then(() => id))
    );

    const connected: string[] = [];
    const failed: ConnectAllResult['failed'] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === 'fulfilled') {
        connected.push(result.value);
      } else {
        failed.push({ id: entries[i]![0], error: errorMessage(result.reason) });
      }
    }

    this.log.info('MCP server connection summary', {
      connected: connected.length,
      failed: failed.length,
    });

    return { connected, failed };
  }

  /**
   * Connects to a single MCP server, discovers its tools, and stores the connection.
   */
  async connectServer(id: string, rawConfig: MCPConfig): Promise<void> {
    this.log.info(`Connecting to MCP server '${id}'`);

    const config = this.expandConfig(rawConfig);
    const transport = this.detectTransport(config);
    const server = this.createClient(id, transport, config);

    try {
      await server.connect();
    } catch (err) {
      const msg = errorMessage(err);
      this.log.error(`Failed to connect MCP server '${id}'`, { error: msg });
      throw new Error(`MCP server '${id}' connection failed: ${msg}`);
    }

    let tools: ToolDefinition[] = [];
    try {
      tools = await server.listTools();
    } catch (err) {
      this.log.warn(`MCP server '${id}' connected but tool discovery failed`, { error: errorMessage(err) });
    }

    this.servers.set(id, { server, tools });

    this.log.info(`MCP server '${id}' ready`, {
      transport,
      toolCount: tools.length,
    });
  }

  /**
   * Detects the transport type from config.
   * Priority: explicit type > command (stdio) > url (http).
   */
  detectTransport(config: MCPConfig): MCPTransport {
    if (config.type) return config.type;
    if (config.command) return 'stdio';
    if (config.url) return 'http';
    throw new Error('Cannot detect MCP transport: config must have "type", "command", or "url"');
  }

  /**
   * Returns all tool definitions from all connected servers.
   * Tool names are qualified as mcp__<serverId>__<originalToolName>.
   */
  getToolDefinitions(): ToolDefinition[] {
    const allTools: ToolDefinition[] = [];

    for (const [serverId, { tools }] of this.servers) {
      for (const tool of tools) {
        allTools.push({
          name: `mcp__${serverId}__${tool.name}`,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }
    }

    return allTools;
  }

  /**
   * Routes a qualified tool call to the correct MCP server.
   * Qualified name format: mcp__<serverId>__<originalToolName>
   */
  async callTool(qualifiedName: string, input: unknown): Promise<unknown> {
    const parsed = this.parseQualifiedName(qualifiedName);
    if (!parsed) {
      throw new Error(`Invalid MCP tool name format: '${qualifiedName}'`);
    }

    const { serverId, toolName } = parsed;
    const entry = this.servers.get(serverId);
    if (!entry) {
      throw new Error(`MCP server '${serverId}' not found for tool '${qualifiedName}'`);
    }

    return entry.server.callTool(toolName, input as Record<string, unknown>);
  }

  /**
   * Disconnects all connected MCP servers.
   */
  async disconnectAll(): Promise<void> {
    const entries = [...this.servers.entries()];
    if (entries.length === 0) {
      return;
    }

    const results = await Promise.allSettled(
      entries.map(async ([id, { server }]) => {
        this.log.info(`Disconnecting MCP server '${id}'`);
        await server.disconnect();
      })
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        this.log.error('Failed to disconnect MCP server', { error: errorMessage(result.reason) });
      }
    }

    this.servers.clear();
    this.log.info('All MCP servers disconnected');
  }

  /** Returns the number of connected servers. */
  get serverCount(): number {
    return this.servers.size;
  }

  /** Checks if a specific server is connected. */
  isConnected(serverId: string): boolean {
    return this.servers.has(serverId);
  }

  private parseQualifiedName(qualifiedName: string): { serverId: string; toolName: string } | null {
    if (!qualifiedName.startsWith('mcp__')) {
      return null;
    }

    const withoutPrefix = qualifiedName.slice('mcp__'.length);
    const separatorIndex = withoutPrefix.indexOf('__');
    if (separatorIndex < 1) {
      return null;
    }

    const serverId = withoutPrefix.slice(0, separatorIndex);
    const toolName = withoutPrefix.slice(separatorIndex + 2);
    if (!toolName) {
      return null;
    }

    return { serverId, toolName };
  }
}
