/**
 * MCP Server Manager Unit Tests
 *
 * Tests lifecycle management, tool discovery, and tool call routing
 * for the MCPServerManager class.
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import type { MCPServer, MCPConfig, ToolDefinition, MCPTransport } from '@daemux/mcp-client';
import { MCPServerManager } from '../../../src/core/mcp/server-manager';
import type { MCPServerManagerDeps } from '../../../src/core/mcp/server-manager';

// ---------------------------------------------------------------------------
// Mock Helpers
// ---------------------------------------------------------------------------

function createMockLogger() {
  return {
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };
}

function createMockServer(overrides: Partial<MCPServer> = {}): MCPServer {
  return {
    id: 'mock',
    transport: 'stdio' as MCPTransport,
    connect: mock(async () => {}),
    disconnect: mock(async () => {}),
    listTools: mock(async () => []),
    callTool: mock(async () => ({ result: 'ok' })),
    listResources: mock(async () => []),
    readResource: mock(async () => ({ content: '' })),
    ...overrides,
  };
}

const sampleTools: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read a file from disk',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCPServerManager', () => {
  let logger: ReturnType<typeof createMockLogger>;
  let mockCreateMCPClient: ReturnType<typeof mock>;
  let mockExpandMCPConfig: ReturnType<typeof mock>;
  let lastCreatedServers: Map<string, MCPServer>;
  let deps: MCPServerManagerDeps;

  function createManager(): InstanceType<typeof MCPServerManager> {
    return new MCPServerManager(logger, deps);
  }

  beforeEach(() => {
    logger = createMockLogger();
    lastCreatedServers = new Map();

    mockCreateMCPClient = mock(
      (_id: string, _transport: MCPTransport, _config: MCPConfig) => {
        const server = createMockServer({
          id: _id,
          listTools: mock(async () => []),
        });
        lastCreatedServers.set(_id, server);
        return server;
      }
    );

    mockExpandMCPConfig = mock((config: MCPConfig) => config);

    deps = {
      createMCPClient: mockCreateMCPClient as MCPServerManagerDeps['createMCPClient'],
      expandMCPConfig: mockExpandMCPConfig as MCPServerManagerDeps['expandMCPConfig'],
    };
  });

  // -------------------------------------------------------------------------
  // Transport Detection
  // -------------------------------------------------------------------------

  describe('detectTransport', () => {
    it('should return explicit type when set', () => {
      const manager = createManager();
      const result = manager.detectTransport({ type: 'sse', url: 'http://localhost' });
      expect(result).toBe('sse');
    });

    it('should return stdio when command is set without explicit type', () => {
      const manager = createManager();
      const result = manager.detectTransport({ command: 'npx', args: ['server'] });
      expect(result).toBe('stdio');
    });

    it('should return http when url is set without explicit type or command', () => {
      const manager = createManager();
      const result = manager.detectTransport({ url: 'http://localhost:3000/mcp' });
      expect(result).toBe('http');
    });

    it('should prefer explicit type over command', () => {
      const manager = createManager();
      const result = manager.detectTransport({ type: 'websocket', command: 'npx' });
      expect(result).toBe('websocket');
    });

    it('should prefer command over url when no explicit type', () => {
      const manager = createManager();
      const result = manager.detectTransport({ command: 'npx', url: 'http://localhost' });
      expect(result).toBe('stdio');
    });

    it('should throw when neither type, command, nor url is set', () => {
      const manager = createManager();
      expect(() => manager.detectTransport({})).toThrow('Cannot detect MCP transport');
    });
  });

  // -------------------------------------------------------------------------
  // connectServer
  // -------------------------------------------------------------------------

  describe('connectServer', () => {
    it('should expand env vars before creating client', async () => {
      const rawConfig: MCPConfig = { command: '${MY_CMD}', args: ['--port', '${PORT}'] };
      const expandedConfig: MCPConfig = { command: 'my-server', args: ['--port', '3000'] };
      mockExpandMCPConfig.mockImplementation(() => expandedConfig);

      const manager = createManager();
      await manager.connectServer('test-server', rawConfig);

      expect(mockExpandMCPConfig).toHaveBeenCalledWith(rawConfig);
      expect(mockCreateMCPClient).toHaveBeenCalledWith('test-server', 'stdio', expandedConfig);
    });

    it('should call server.connect() and server.listTools()', async () => {
      const manager = createManager();
      const config: MCPConfig = { command: 'npx', args: ['test-server'] };
      await manager.connectServer('srv', config);

      const server = lastCreatedServers.get('srv')!;
      expect(server.connect).toHaveBeenCalledTimes(1);
      expect(server.listTools).toHaveBeenCalledTimes(1);
    });

    it('should store server and tools after successful connection', async () => {
      mockCreateMCPClient.mockImplementation(
        (_id: string, _transport: MCPTransport, _config: MCPConfig) => {
          const server = createMockServer({
            id: _id,
            listTools: mock(async () => sampleTools),
          });
          lastCreatedServers.set(_id, server);
          return server;
        }
      );

      const manager = createManager();
      await manager.connectServer('fs-server', { command: 'fs-mcp' });

      expect(manager.isConnected('fs-server')).toBe(true);
      expect(manager.serverCount).toBe(1);

      const tools = manager.getToolDefinitions();
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe('mcp__fs-server__read_file');
    });

    it('should throw and log on connection failure', async () => {
      mockCreateMCPClient.mockImplementation(
        (_id: string) => {
          return createMockServer({
            id: _id,
            connect: mock(async () => { throw new Error('Connection refused'); }),
          });
        }
      );

      const manager = createManager();
      await expect(
        manager.connectServer('bad-server', { command: 'bad-cmd' })
      ).rejects.toThrow("MCP server 'bad-server' connection failed: Connection refused");

      expect(logger.error).toHaveBeenCalled();
    });

    it('should still store server when tool discovery fails', async () => {
      mockCreateMCPClient.mockImplementation(
        (_id: string) => {
          const server = createMockServer({
            id: _id,
            listTools: mock(async () => { throw new Error('tools/list not supported'); }),
          });
          lastCreatedServers.set(_id, server);
          return server;
        }
      );

      const manager = createManager();
      await manager.connectServer('no-tools', { command: 'legacy-server' });

      expect(manager.isConnected('no-tools')).toBe(true);
      expect(manager.getToolDefinitions()).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // connectAll
  // -------------------------------------------------------------------------

  describe('connectAll', () => {
    it('should connect multiple servers in parallel', async () => {
      mockCreateMCPClient.mockImplementation(
        (_id: string) => {
          const server = createMockServer({
            id: _id,
            listTools: mock(async () =>
              _id === 'alpha'
                ? [sampleTools[0]]
                : [sampleTools[1]]
            ),
          });
          lastCreatedServers.set(_id, server);
          return server;
        }
      );

      const manager = createManager();
      const configs: Record<string, MCPConfig> = {
        alpha: { command: 'alpha-server' },
        beta: { url: 'http://beta.local/mcp' },
      };

      const result = await manager.connectAll(configs);

      expect(result.connected).toHaveLength(2);
      expect(result.connected).toContain('alpha');
      expect(result.connected).toContain('beta');
      expect(result.failed).toHaveLength(0);
      expect(manager.serverCount).toBe(2);
    });

    it('should return failed servers without crashing other connections', async () => {
      mockCreateMCPClient.mockImplementation(
        (_id: string) => {
          if (_id === 'failing') {
            return createMockServer({
              id: _id,
              connect: mock(async () => { throw new Error('Network error'); }),
            });
          }
          const server = createMockServer({
            id: _id,
            listTools: mock(async () => sampleTools),
          });
          lastCreatedServers.set(_id, server);
          return server;
        }
      );

      const manager = createManager();
      const result = await manager.connectAll({
        good: { command: 'good-server' },
        failing: { command: 'failing-server' },
      });

      expect(result.connected).toContain('good');
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].id).toBe('failing');
      expect(result.failed[0].error).toContain('Network error');
      expect(manager.isConnected('good')).toBe(true);
      expect(manager.isConnected('failing')).toBe(false);
    });

    it('should return empty results for empty configs', async () => {
      const manager = createManager();
      const result = await manager.connectAll({});
      expect(result.connected).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // getToolDefinitions
  // -------------------------------------------------------------------------

  describe('getToolDefinitions', () => {
    it('should aggregate tools from all servers with qualified names', async () => {
      mockCreateMCPClient.mockImplementation(
        (_id: string) => {
          const tools = _id === 'srv-a'
            ? [sampleTools[0]]
            : [sampleTools[1]];
          const server = createMockServer({
            id: _id,
            listTools: mock(async () => tools),
          });
          lastCreatedServers.set(_id, server);
          return server;
        }
      );

      const manager = createManager();
      await manager.connectAll({
        'srv-a': { command: 'a' },
        'srv-b': { command: 'b' },
      });

      const allTools = manager.getToolDefinitions();
      expect(allTools).toHaveLength(2);

      const names = allTools.map((t) => t.name);
      expect(names).toContain('mcp__srv-a__read_file');
      expect(names).toContain('mcp__srv-b__write_file');
    });

    it('should preserve original description and inputSchema', async () => {
      mockCreateMCPClient.mockImplementation(
        (_id: string) => {
          const server = createMockServer({
            id: _id,
            listTools: mock(async () => [sampleTools[0]]),
          });
          lastCreatedServers.set(_id, server);
          return server;
        }
      );

      const manager = createManager();
      await manager.connectServer('srv', { command: 'x' });
      const tools = manager.getToolDefinitions();

      expect(tools[0].description).toBe('Read a file from disk');
      expect(tools[0].inputSchema).toEqual(sampleTools[0].inputSchema);
    });

    it('should return empty array when no servers connected', () => {
      const manager = createManager();
      expect(manager.getToolDefinitions()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // callTool
  // -------------------------------------------------------------------------

  describe('callTool', () => {
    it('should route to correct server with original tool name', async () => {
      const callToolFn = mock(async (name: string, input: Record<string, unknown>) => ({
        content: `read: ${input.path}`,
      }));

      mockCreateMCPClient.mockImplementation(
        (_id: string) => {
          const server = createMockServer({
            id: _id,
            listTools: mock(async () => sampleTools),
            callTool: callToolFn,
          });
          lastCreatedServers.set(_id, server);
          return server;
        }
      );

      const manager = createManager();
      await manager.connectServer('file-srv', { command: 'file-mcp' });
      const result = await manager.callTool('mcp__file-srv__read_file', { path: '/tmp/test.txt' });

      expect(callToolFn).toHaveBeenCalledWith('read_file', { path: '/tmp/test.txt' });
      expect(result).toEqual({ content: 'read: /tmp/test.txt' });
    });

    it('should throw for unknown server ID in qualified name', async () => {
      const manager = createManager();
      await expect(
        manager.callTool('mcp__nonexistent__some_tool', {})
      ).rejects.toThrow("MCP server 'nonexistent' not found");
    });

    it('should throw for invalid qualified name format', async () => {
      const manager = createManager();
      await expect(
        manager.callTool('invalid_name', {})
      ).rejects.toThrow('Invalid MCP tool name format');
    });

    it('should throw for name with prefix but no tool part', async () => {
      const manager = createManager();
      await expect(
        manager.callTool('mcp__server__', {})
      ).rejects.toThrow('Invalid MCP tool name format');
    });

    it('should throw for name with prefix but no separator after server', async () => {
      const manager = createManager();
      await expect(
        manager.callTool('mcp__server', {})
      ).rejects.toThrow('Invalid MCP tool name format');
    });
  });

  // -------------------------------------------------------------------------
  // disconnectAll
  // -------------------------------------------------------------------------

  describe('disconnectAll', () => {
    it('should disconnect all servers and clear internal state', async () => {
      mockCreateMCPClient.mockImplementation(
        (_id: string) => {
          const server = createMockServer({ id: _id });
          lastCreatedServers.set(_id, server);
          return server;
        }
      );

      const manager = createManager();
      await manager.connectAll({
        s1: { command: 'cmd1' },
        s2: { command: 'cmd2' },
      });

      expect(manager.serverCount).toBe(2);
      await manager.disconnectAll();

      expect(manager.serverCount).toBe(0);
      expect(manager.getToolDefinitions()).toHaveLength(0);

      const s1 = lastCreatedServers.get('s1')!;
      const s2 = lastCreatedServers.get('s2')!;
      expect(s1.disconnect).toHaveBeenCalledTimes(1);
      expect(s2.disconnect).toHaveBeenCalledTimes(1);
    });

    it('should log errors but not throw when disconnect fails', async () => {
      mockCreateMCPClient.mockImplementation(
        (_id: string) => {
          const server = createMockServer({
            id: _id,
            disconnect: mock(async () => { throw new Error('Disconnect timeout'); }),
          });
          lastCreatedServers.set(_id, server);
          return server;
        }
      );

      const manager = createManager();
      await manager.connectServer('flaky', { command: 'flaky-server' });
      await manager.disconnectAll();

      expect(manager.serverCount).toBe(0);
      expect(logger.error).toHaveBeenCalled();
    });

    it('should be safe to call when no servers are connected', async () => {
      const manager = createManager();
      await manager.disconnectAll();
      expect(manager.serverCount).toBe(0);
    });
  });
});
