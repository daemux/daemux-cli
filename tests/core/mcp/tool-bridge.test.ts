/**
 * MCP Tool Bridge Tests
 * Verifies that createMCPToolBridge correctly creates executors
 * from an MCPServerManager for the agentic loop.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  createMCPToolBridge,
  type MCPServerManagerLike,
} from '../../../src/core/mcp/tool-bridge';
import type { ToolDefinition } from '../../../src/core/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(name: string, desc = 'test tool'): ToolDefinition {
  return {
    name,
    description: desc,
    inputSchema: { type: 'object', properties: {}, required: [] },
  };
}

function makeManager(
  tools: ToolDefinition[],
  callFn: (name: string, input: unknown) => Promise<unknown>,
): MCPServerManagerLike {
  return {
    getToolDefinitions: () => tools,
    callTool: callFn,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createMCPToolBridge', () => {
  const TOOL_USE_ID = 'tu_test_001';

  it('should create executors for all tools from manager', () => {
    const tools = [makeTool('mcp__git__status'), makeTool('mcp__git__diff')];
    const manager = makeManager(tools, async () => 'ok');

    const bridge = createMCPToolBridge(manager);

    expect(bridge.tools).toHaveLength(2);
    expect(bridge.executors.size).toBe(2);
  });

  it('should have executor map keys matching tool names', () => {
    const tools = [makeTool('mcp__fs__read'), makeTool('mcp__fs__write')];
    const manager = makeManager(tools, async () => '');

    const bridge = createMCPToolBridge(manager);

    expect(bridge.executors.has('mcp__fs__read')).toBe(true);
    expect(bridge.executors.has('mcp__fs__write')).toBe(true);
  });

  it('should return string content as-is', async () => {
    const tools = [makeTool('mcp__echo__say')];
    const manager = makeManager(tools, async () => 'hello world');

    const bridge = createMCPToolBridge(manager);
    const executor = bridge.executors.get('mcp__echo__say')!;
    const result = await executor(TOOL_USE_ID, { text: 'hello world' });

    expect(result.toolUseId).toBe(TOOL_USE_ID);
    expect(result.content).toBe('hello world');
    expect(result.isError).toBeUndefined();
  });

  it('should JSON-stringify object results', async () => {
    const payload = { files: ['a.ts', 'b.ts'], count: 2 };
    const tools = [makeTool('mcp__fs__list')];
    const manager = makeManager(tools, async () => payload);

    const bridge = createMCPToolBridge(manager);
    const executor = bridge.executors.get('mcp__fs__list')!;
    const result = await executor(TOOL_USE_ID, {});

    expect(result.content).toBe(JSON.stringify(payload));
    expect(result.isError).toBeUndefined();
  });

  it('should JSON-stringify array results', async () => {
    const payload = ['item1', 'item2'];
    const tools = [makeTool('mcp__db__query')];
    const manager = makeManager(tools, async () => payload);

    const bridge = createMCPToolBridge(manager);
    const executor = bridge.executors.get('mcp__db__query')!;
    const result = await executor(TOOL_USE_ID, {});

    expect(result.content).toBe(JSON.stringify(payload));
  });

  it('should return empty string for null/undefined results', async () => {
    const tools = [makeTool('mcp__void__noop')];
    const manager = makeManager(tools, async () => undefined);

    const bridge = createMCPToolBridge(manager);
    const executor = bridge.executors.get('mcp__void__noop')!;
    const result = await executor(TOOL_USE_ID, {});

    expect(result.content).toBe('');
    expect(result.isError).toBeUndefined();
  });

  it('should return isError true with structured content on error', async () => {
    const tools = [makeTool('mcp__api__call')];
    const manager = makeManager(tools, async () => {
      throw new Error('connection refused');
    });

    const bridge = createMCPToolBridge(manager);
    const executor = bridge.executors.get('mcp__api__call')!;
    const result = await executor(TOOL_USE_ID, {});

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content);
    expect(parsed.isError).toBe(true);
    expect(parsed.content).toEqual([{ type: 'text', text: 'connection refused' }]);
  });

  it('should handle non-Error thrown values', async () => {
    const tools = [makeTool('mcp__bad__throw')];
    const manager = makeManager(tools, async () => {
      throw 'string error';
    });

    const bridge = createMCPToolBridge(manager);
    const executor = bridge.executors.get('mcp__bad__throw')!;
    const result = await executor(TOOL_USE_ID, {});

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content);
    expect(parsed.content[0].text).toBe('string error');
  });

  it('should return empty tools and executors for empty tool list', () => {
    const manager = makeManager([], async () => 'unreachable');

    const bridge = createMCPToolBridge(manager);

    expect(bridge.tools).toHaveLength(0);
    expect(bridge.executors.size).toBe(0);
  });

  it('should pass input to manager.callTool', async () => {
    const tools = [makeTool('mcp__grpc__invoke')];
    let capturedName = '';
    let capturedInput: unknown = null;
    const manager = makeManager(tools, async (name, input) => {
      capturedName = name;
      capturedInput = input;
      return 'done';
    });

    const bridge = createMCPToolBridge(manager);
    const executor = bridge.executors.get('mcp__grpc__invoke')!;
    await executor(TOOL_USE_ID, { method: 'GetUser', id: 42 });

    expect(capturedName).toBe('mcp__grpc__invoke');
    expect(capturedInput).toEqual({ method: 'GetUser', id: 42 });
  });

  it('should return tools matching ToolDefinition shape', () => {
    const tools = [makeTool('mcp__srv__action', 'does something')];
    const manager = makeManager(tools, async () => '');

    const bridge = createMCPToolBridge(manager);
    const tool = bridge.tools[0];

    expect(tool.name).toBe('mcp__srv__action');
    expect(tool.description).toBe('does something');
    expect(tool.inputSchema.type).toBe('object');
  });

  it('should JSON-stringify numeric results', async () => {
    const tools = [makeTool('mcp__math__add')];
    const manager = makeManager(tools, async () => 42);

    const bridge = createMCPToolBridge(manager);
    const executor = bridge.executors.get('mcp__math__add')!;
    const result = await executor(TOOL_USE_ID, {});

    expect(result.content).toBe('42');
  });
});
