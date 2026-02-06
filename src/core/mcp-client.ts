/**
 * MCP Client - Model Context Protocol stdio transport
 * Connects to MCP servers via subprocess, communicates using JSON-RPC 2.0
 */

import type { ToolDefinition } from './types';
import type { MCPServer, MCPConfig, MCPTransport } from './plugin-api-types';
import type { Logger } from '../infra/logger';
import { SseMCPClient } from './mcp-sse-client';
import { HttpMCPClient } from './mcp-http-client';
import { WebSocketMCPClient } from './mcp-ws-client';
import {
  PROTOCOL_VERSION,
  mapToolsList,
  handleToolCallResult,
  mapResourcesList,
  handleResourceReadResult,
  spawnMCPProcess,
} from './mcp-client-utils';
import type {
  SubprocessHandle,
  ToolsListResult,
  ToolCallResult,
  ResourcesListResult,
  ResourceReadResult,
} from './mcp-client-utils';
import { JsonRpcTransport } from './mcp-jsonrpc';

// ---------------------------------------------------------------------------
// StdioMCPClient
// ---------------------------------------------------------------------------

export class StdioMCPClient implements MCPServer {
  readonly id: string;
  readonly transport: MCPTransport = 'stdio';

  private proc: SubprocessHandle | null = null;
  private connected = false;
  private config: MCPConfig;
  private log: Logger | undefined;
  private rpc: JsonRpcTransport;

  constructor(id: string, config: MCPConfig, logger?: Logger) {
    this.id = id;
    this.config = config;
    this.log = logger;
    this.rpc = new JsonRpcTransport(id, logger);
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const command = this.config.command;
    if (!command) {
      throw new Error(`MCP server '${this.id}': command is required for stdio transport`);
    }

    const args = this.config.args ?? [];
    const env = { ...process.env, ...this.config.env };

    this.log?.debug(`MCP connecting to '${this.id}'`, { command, args });

    this.proc = spawnMCPProcess(command, args, env);
    this.rpc.attach(this.proc);

    this.rpc.startReadLoop();
    this.monitorProcess();

    await this.initializeProtocol();
    this.connected = true;

    this.log?.info(`MCP server '${this.id}' connected`);
  }

  async disconnect(): Promise<void> {
    if (!this.connected || !this.proc) return;

    this.connected = false;

    this.rpc.sendNotification('notifications/cancelled', {});
    this.rpc.clearPending('MCP client disconnected');
    this.rpc.detach();

    try {
      this.proc.kill();
    } catch {
      // Process may already be dead
    }

    this.proc = null;

    this.log?.info(`MCP server '${this.id}' disconnected`);
  }

  async listTools(): Promise<ToolDefinition[]> {
    this.assertConnected();
    return mapToolsList(await this.rpc.sendRequest('tools/list', {}) as ToolsListResult);
  }

  async callTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    this.assertConnected();
    return handleToolCallResult(
      name,
      await this.rpc.sendRequest('tools/call', { name, arguments: input }) as ToolCallResult
    );
  }

  async listResources(): Promise<Array<{ uri: string; name: string; mimeType?: string }>> {
    this.assertConnected();
    return mapResourcesList(await this.rpc.sendRequest('resources/list', {}) as ResourcesListResult);
  }

  async readResource(uri: string): Promise<{ content: string; mimeType?: string }> {
    this.assertConnected();
    return handleResourceReadResult(
      uri,
      await this.rpc.sendRequest('resources/read', { uri }) as ResourceReadResult
    );
  }

  // ---------------------------------------------------------------------------
  // Private: Protocol Init & Process Monitoring
  // ---------------------------------------------------------------------------

  private async initializeProtocol(): Promise<void> {
    const result = await this.rpc.sendRequest('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {}, resources: {} },
      clientInfo: { name: 'daemux', version: '1.0.0' },
    });

    this.log?.debug(`MCP '${this.id}' initialized`, { result });

    this.rpc.sendNotification('notifications/initialized', {});
  }

  private monitorProcess(): void {
    if (!this.proc) return;

    void new Response(this.proc.stderr).text().then((text) => {
      if (text.trim()) {
        this.log?.debug(`MCP '${this.id}' stderr`, { output: text.slice(0, 2000) });
      }
    }).catch(() => {
      // Stderr read failed, non-critical
    });

    void this.proc.exited.then((code) => {
      if (this.connected) {
        this.log?.warn(`MCP server '${this.id}' exited unexpectedly`, { code });
        this.connected = false;
        this.rpc.clearPending(`MCP server process exited with code ${code}`);
        this.rpc.detach();
      }
    });
  }

  private assertConnected(): void {
    if (!this.connected || !this.proc) {
      throw new Error(`MCP server '${this.id}' is not connected`);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory Function
// ---------------------------------------------------------------------------

export function createMCPClient(
  id: string,
  transport: MCPTransport,
  config: MCPConfig,
  logger?: Logger
): MCPServer {
  switch (transport) {
    case 'stdio':
      return new StdioMCPClient(id, config, logger);
    case 'sse':
      return new SseMCPClient(id, config, logger);
    case 'http':
      return new HttpMCPClient(id, config, logger);
    case 'websocket':
      return new WebSocketMCPClient(id, config, logger);
    default:
      throw new Error(`MCP transport '${transport}' is not supported.`);
  }
}
