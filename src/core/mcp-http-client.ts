/**
 * MCP HTTP Client - Stateless HTTP POST transport
 * Each request/response is a single fetch POST cycle using JSON-RPC 2.0
 */

import type { ToolDefinition } from './types';
import type { MCPServer, MCPConfig, MCPTransport } from './plugin-api-types';
import type { Logger } from '../infra/logger';
import {
  JSONRPC_VERSION,
  DEFAULT_TIMEOUT_MS,
  mapToolsList,
  handleToolCallResult,
  mapResourcesList,
  handleResourceReadResult,
  buildInitializeParams,
} from './mcp-client-utils';
import type {
  JsonRpcResponse,
  ToolsListResult,
  ToolCallResult,
  ResourcesListResult,
  ResourceReadResult,
} from './mcp-client-utils';

// ---------------------------------------------------------------------------
// HTTP MCP Client
// ---------------------------------------------------------------------------

export class HttpMCPClient implements MCPServer {
  readonly id: string;
  readonly transport: MCPTransport = 'http';

  private connected = false;
  private config: MCPConfig;
  private log: Logger | undefined;
  private requestId = 0;
  private sessionId: string | null = null;

  constructor(id: string, config: MCPConfig, logger?: Logger) {
    this.id = id;
    this.config = config;
    this.log = logger;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    if (!this.config.url) {
      throw new Error(`MCP server '${this.id}': url is required for HTTP transport`);
    }

    this.log?.debug(`MCP HTTP connecting to '${this.id}'`, { url: this.config.url });

    await this.sendRequest('initialize', buildInitializeParams());
    this.connected = true;

    this.log?.info(`MCP server '${this.id}' connected via HTTP`);
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    this.sessionId = null;
    this.log?.info(`MCP server '${this.id}' disconnected`);
  }

  async listTools(): Promise<ToolDefinition[]> {
    this.assertConnected();
    return mapToolsList(await this.sendRequest('tools/list', {}) as ToolsListResult);
  }

  async callTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    this.assertConnected();
    return handleToolCallResult(
      name,
      await this.sendRequest('tools/call', { name, arguments: input }) as ToolCallResult
    );
  }

  async listResources(): Promise<Array<{ uri: string; name: string; mimeType?: string }>> {
    this.assertConnected();
    return mapResourcesList(await this.sendRequest('resources/list', {}) as ResourcesListResult);
  }

  async readResource(uri: string): Promise<{ content: string; mimeType?: string }> {
    this.assertConnected();
    return handleResourceReadResult(
      uri,
      await this.sendRequest('resources/read', { uri }) as ResourceReadResult
    );
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const url = this.config.url!;
    const id = ++this.requestId;
    const body = JSON.stringify({
      jsonrpc: JSONRPC_VERSION,
      id,
      method,
      params: params ?? {},
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      const respSessionId = response.headers.get('Mcp-Session-Id');
      if (respSessionId) {
        this.sessionId = respSessionId;
      }

      if (!response.ok) {
        throw new Error(`MCP HTTP server '${this.id}' returned ${response.status}: ${response.statusText}`);
      }

      const parsed = await response.json() as JsonRpcResponse;

      if (parsed.error) {
        throw new Error(`MCP error (${parsed.error.code}): ${parsed.error.message}`);
      }

      return parsed.result;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private assertConnected(): void {
    if (!this.connected) {
      throw new Error(`MCP server '${this.id}' is not connected`);
    }
  }
}
