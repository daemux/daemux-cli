/**
 * MCP JSON-RPC Communication Layer
 * Handles JSON-RPC request/response lifecycle, message writing, and stdout reading.
 */

import type { Logger } from '../infra/logger';
import {
  JSONRPC_VERSION,
  DEFAULT_TIMEOUT_MS,
} from './mcp-client-utils';
import type {
  JsonRpcRequest,
  JsonRpcNotification,
  JsonRpcResponse,
  PendingRequest,
  SubprocessHandle,
} from './mcp-client-utils';

// ---------------------------------------------------------------------------
// JSON-RPC Transport
// ---------------------------------------------------------------------------

export class JsonRpcTransport {
  private proc: SubprocessHandle | null = null;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private buffer = '';
  private readLoopActive = false;
  private log: Logger | undefined;
  private serverId: string;

  constructor(serverId: string, logger?: Logger) {
    this.serverId = serverId;
    this.log = logger;
  }

  attach(proc: SubprocessHandle): void {
    this.proc = proc;
  }

  detach(): void {
    this.readLoopActive = false;
    this.proc = null;
    this.buffer = '';
  }

  isAttached(): boolean {
    return this.proc !== null;
  }

  clearPending(reason: string): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(new Error(reason));
    }
    this.pending.clear();
  }

  sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.proc) {
      return Promise.reject(new Error(`MCP server '${this.serverId}' is not running`));
    }

    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: JSONRPC_VERSION,
      id,
      method,
      params: params ?? {},
    };

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request '${method}' timed out after ${DEFAULT_TIMEOUT_MS}ms`));
      }, DEFAULT_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timeout });
      this.writeMessage(request);
    });
  }

  sendNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.proc) return;

    const notification: JsonRpcNotification = {
      jsonrpc: JSONRPC_VERSION,
      method,
      params: params ?? {},
    };

    this.writeMessage(notification);
  }

  startReadLoop(): void {
    if (!this.proc) return;
    this.readLoopActive = true;
    void this.readStdout();
  }

  // ---------------------------------------------------------------------------
  // Private: Message Writing
  // ---------------------------------------------------------------------------

  private writeMessage(message: JsonRpcRequest | JsonRpcNotification): void {
    if (!this.proc) return;

    try {
      const data = JSON.stringify(message) + '\n';
      this.proc.stdin.write(data);
      this.proc.stdin.flush();
    } catch (err) {
      this.log?.error(`MCP '${this.serverId}' write failed`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Response Handling
  // ---------------------------------------------------------------------------

  private handleLine(data: string): void {
    let parsed: JsonRpcResponse;

    try {
      parsed = JSON.parse(data) as JsonRpcResponse;
    } catch {
      this.log?.debug(`MCP '${this.serverId}' received non-JSON line`, {
        data: data.slice(0, 200),
      });
      return;
    }

    if (parsed.id === undefined || parsed.id === null) {
      this.log?.debug(`MCP '${this.serverId}' received notification`, {
        message: data.slice(0, 500),
      });
      return;
    }

    const pending = this.pending.get(parsed.id);
    if (!pending) {
      this.log?.debug(`MCP '${this.serverId}' unknown response id`, { id: parsed.id });
      return;
    }

    this.pending.delete(parsed.id);
    clearTimeout(pending.timeout);

    if (parsed.error) {
      pending.reject(new Error(
        `MCP error (${parsed.error.code}): ${parsed.error.message}`
      ));
    } else {
      pending.resolve(parsed.result);
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Stdout Reading
  // ---------------------------------------------------------------------------

  private async readStdout(): Promise<void> {
    if (!this.proc) return;

    const reader = this.proc.stdout.getReader();
    const decoder = new TextDecoder();

    try {
      while (this.readLoopActive) {
        const { done, value } = await reader.read();
        if (done) break;

        this.buffer += typeof value === 'string' ? value : decoder.decode(value);

        let idx = this.buffer.indexOf('\n');
        while (idx !== -1) {
          const line = this.buffer.slice(0, idx).trim();
          this.buffer = this.buffer.slice(idx + 1);

          if (line.length > 0) {
            this.handleLine(line);
          }

          idx = this.buffer.indexOf('\n');
        }
      }
    } catch (err) {
      if (this.proc) {
        this.log?.error(`MCP '${this.serverId}' stdout read error`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      reader.releaseLock();
    }
  }
}
