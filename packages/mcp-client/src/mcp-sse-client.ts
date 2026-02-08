/**
 * MCP SSE Client - Server-Sent Events transport
 * Uses EventSource for server->client and fetch POST for client->server
 */

import type { ToolDefinition, MCPServer, MCPConfig, MCPTransport, Logger } from './types';
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
// SSE MCP Client
// ---------------------------------------------------------------------------

export class SseMCPClient implements MCPServer {
  readonly id: string;
  readonly transport: MCPTransport = 'sse';

  private connected = false;
  private config: MCPConfig;
  private log: Logger | undefined;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private postEndpoint: string | null = null;
  private abortController: AbortController | null = null;

  constructor(id: string, config: MCPConfig, logger?: Logger) {
    this.id = id;
    this.config = config;
    this.log = logger;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const baseUrl = this.config.url;
    if (!baseUrl) {
      throw new Error(`MCP server '${this.id}': url is required for SSE transport`);
    }

    this.log?.debug(`MCP SSE connecting to '${this.id}'`, { url: baseUrl });

    this.abortController = new AbortController();
    const sseUrl = baseUrl.endsWith('/sse') ? baseUrl : `${baseUrl}/sse`;

    await this.startEventStream(sseUrl);
    await this.sendRequest('initialize', buildInitializeParams());
    this.connected = true;

    this.log?.info(`MCP server '${this.id}' connected via SSE`);
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    this.connected = false;
    this.abortController?.abort();
    this.abortController = null;
    clearPendingRequests(this.pending, 'SSE client disconnected');

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

  private async startEventStream(sseUrl: string): Promise<void> {
    const response = await fetch(sseUrl, {
      headers: { Accept: 'text/event-stream' },
      signal: this.abortController?.signal,
    });

    if (!response.ok) {
      throw new Error(`MCP SSE server '${this.id}' returned ${response.status}`);
    }

    const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined;
    if (!reader) throw new Error(`MCP SSE server '${this.id}' returned no body`);

    const decoder = new TextDecoder();
    let buffer = '';

    // Read the first event to get the post endpoint
    while (!this.postEndpoint) {
      const { done, value } = await reader.read();
      if (done) throw new Error(`MCP SSE stream ended before endpoint received`);
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('event: endpoint')) continue;
        if (line.startsWith('data: ')) {
          const endpoint = line.slice(6).trim();
          const baseUrl = this.config.url!;
          this.postEndpoint = endpoint.startsWith('http')
            ? endpoint
            : new URL(endpoint, baseUrl).toString();
          break;
        }
      }
    }

    // Continue reading SSE events in the background for responses
    void this.readSseLoop(reader, decoder, buffer);
  }

  private async readSseLoop(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    decoder: TextDecoder,
    initialBuffer: string
  ): Promise<void> {
    let buffer = initialBuffer;
    try {
      while (this.connected) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            this.handleJsonLine(line.slice(6).trim());
          }
        }
      }
    } catch {
      if (this.connected) {
        this.log?.warn(`MCP SSE '${this.id}' stream read error`);
      }
    } finally {
      reader.releaseLock();
    }
  }

  private handleJsonLine(data: string): void {
    let parsed: JsonRpcResponse;
    try {
      parsed = JSON.parse(data) as JsonRpcResponse;
    } catch {
      return;
    }
    resolveJsonRpcResponse(this.pending, parsed);
  }

  private sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.postEndpoint) {
      return Promise.reject(new Error(`MCP SSE server '${this.id}' has no post endpoint`));
    }

    const id = ++this.requestId;
    const body = JSON.stringify({ jsonrpc: JSONRPC_VERSION, id, method, params: params ?? {} });

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP SSE request '${method}' timed out after ${DEFAULT_TIMEOUT_MS}ms`));
      }, DEFAULT_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timeout });

      fetch(this.postEndpoint!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }).catch(err => {
        this.pending.delete(id);
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  private assertConnected(): void {
    if (!this.connected) {
      throw new Error(`MCP server '${this.id}' is not connected`);
    }
  }
}
