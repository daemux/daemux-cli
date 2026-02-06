/**
 * MCP WebSocket Client - Bidirectional WebSocket transport
 * Uses a single WebSocket connection for both request and response
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
  clearPendingRequests,
  resolveJsonRpcResponse,
} from './mcp-client-utils';
import type {
  JsonRpcResponse,
  PendingRequest,
  ToolsListResult,
  ToolCallResult,
  ResourcesListResult,
  ResourceReadResult,
} from './mcp-client-utils';

// ---------------------------------------------------------------------------
// WebSocket MCP Client
// ---------------------------------------------------------------------------

export class WebSocketMCPClient implements MCPServer {
  readonly id: string;
  readonly transport: MCPTransport = 'websocket';

  private connected = false;
  private config: MCPConfig;
  private log: Logger | undefined;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private ws: WebSocket | null = null;

  constructor(id: string, config: MCPConfig, logger?: Logger) {
    this.id = id;
    this.config = config;
    this.log = logger;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    if (!this.config.url) {
      throw new Error(`MCP server '${this.id}': url is required for WebSocket transport`);
    }

    const wsUrl = this.config.url.replace(/^http/, 'ws');
    this.log?.debug(`MCP WebSocket connecting to '${this.id}'`, { url: wsUrl });

    await this.openWebSocket(wsUrl);
    await this.sendRequest('initialize', buildInitializeParams());
    this.connected = true;

    this.log?.info(`MCP server '${this.id}' connected via WebSocket`);
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    this.connected = false;
    clearPendingRequests(this.pending, 'WebSocket client disconnected');

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

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

  private openWebSocket(url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);

      const connectTimeout = setTimeout(() => {
        ws.close();
        reject(new Error(`MCP WebSocket '${this.id}' connection timed out`));
      }, DEFAULT_TIMEOUT_MS);

      ws.addEventListener('open', () => {
        clearTimeout(connectTimeout);
        this.ws = ws;
        resolve();
      });

      ws.addEventListener('error', (event) => {
        clearTimeout(connectTimeout);
        const errMsg = (event as ErrorEvent).message ?? 'WebSocket connection failed';
        reject(new Error(`MCP WebSocket '${this.id}': ${errMsg}`));
      });

      ws.addEventListener('message', (event) => {
        this.handleMessage(String(event.data));
      });

      ws.addEventListener('close', () => {
        if (this.connected) {
          this.log?.warn(`MCP WebSocket '${this.id}' closed unexpectedly`);
          this.connected = false;
          clearPendingRequests(this.pending, 'WebSocket closed unexpectedly');
        }
        this.ws = null;
      });
    });
  }

  private handleMessage(data: string): void {
    let parsed: JsonRpcResponse;
    try {
      parsed = JSON.parse(data) as JsonRpcResponse;
    } catch {
      this.log?.debug(`MCP WebSocket '${this.id}' received non-JSON message`);
      return;
    }

    if (parsed.id === undefined || parsed.id === null) {
      this.log?.debug(`MCP WebSocket '${this.id}' received notification`);
      return;
    }

    resolveJsonRpcResponse(this.pending, parsed);
  }

  private sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.ws) {
      return Promise.reject(new Error(`MCP WebSocket '${this.id}' is not connected`));
    }

    const id = ++this.requestId;
    const message = JSON.stringify({
      jsonrpc: JSONRPC_VERSION,
      id,
      method,
      params: params ?? {},
    });

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP WebSocket request '${method}' timed out after ${DEFAULT_TIMEOUT_MS}ms`));
      }, DEFAULT_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timeout });

      try {
        this.ws!.send(message);
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timeout);
        reject(err);
      }
    });
  }

  private assertConnected(): void {
    if (!this.connected || !this.ws) {
      throw new Error(`MCP server '${this.id}' is not connected`);
    }
  }
}
