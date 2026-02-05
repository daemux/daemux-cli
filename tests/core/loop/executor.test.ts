/**
 * Tool Executor Unit Tests
 * Tests parallel tool execution and error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { EventBus } from '../../../src/core/event-bus';
import { ToolExecutor } from '../../../src/core/loop/executor';
import type { ToolResult } from '../../../src/core/types';

describe('ToolExecutor', () => {
  let eventBus: EventBus;
  let executor: ToolExecutor;
  const testDir = join(import.meta.dir, 'test-executor-temp');

  beforeEach(() => {
    eventBus = new EventBus();
    executor = new ToolExecutor({ eventBus });
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('Constructor', () => {
    it('should create executor with default allowed tools', () => {
      const exec = new ToolExecutor({ eventBus });
      expect(exec.getAllowedTools()).toContain('Read');
      expect(exec.getAllowedTools()).toContain('Write');
      expect(exec.getAllowedTools()).toContain('Bash');
    });

    it('should create executor with custom allowed tools', () => {
      const exec = new ToolExecutor({
        eventBus,
        allowedTools: ['Read', 'custom_tool'],
      });
      expect(exec.getAllowedTools()).toContain('Read');
      expect(exec.getAllowedTools()).toContain('custom_tool');
      expect(exec.getAllowedTools()).not.toContain('Write');
    });
  });

  describe('isAllowed', () => {
    it('should return true for allowed tools', () => {
      expect(executor.isAllowed('Read')).toBe(true);
      expect(executor.isAllowed('Write')).toBe(true);
      expect(executor.isAllowed('Bash')).toBe(true);
    });

    it('should return false for disallowed tools', () => {
      expect(executor.isAllowed('unknown_tool')).toBe(false);
    });

    it('should update after allowTool', () => {
      expect(executor.isAllowed('new_tool')).toBe(false);
      executor.allowTool('new_tool');
      expect(executor.isAllowed('new_tool')).toBe(true);
    });

    it('should update after disallowTool', () => {
      expect(executor.isAllowed('Bash')).toBe(true);
      executor.disallowTool('Bash');
      expect(executor.isAllowed('Bash')).toBe(false);
    });
  });

  describe('registerExecutor', () => {
    it('should register custom executor', async () => {
      const customExecutor = async (id: string, input: Record<string, unknown>): Promise<ToolResult> => ({
        toolUseId: id,
        content: `Custom: ${JSON.stringify(input)}`,
        isError: false,
      });

      executor.allowTool('custom');
      executor.registerExecutor('custom', customExecutor);

      const result = await executor.execute({
        type: 'tool_use',
        id: 'test-1',
        name: 'custom',
        input: { key: 'value' },
      });

      expect(result.content).toContain('Custom');
      expect(result.content).toContain('value');
    });

    it('should override builtin executor', async () => {
      const overrideExecutor = async (id: string): Promise<ToolResult> => ({
        toolUseId: id,
        content: 'Overridden Bash',
        isError: false,
      });

      executor.registerExecutor('Bash', overrideExecutor);

      const result = await executor.execute({
        type: 'tool_use',
        id: 'test-2',
        name: 'Bash',
        input: { command: 'echo hello' },
      });

      expect(result.content).toBe('Overridden Bash');
    });
  });

  describe('execute', () => {
    it('should execute Read', async () => {
      const filePath = join(testDir, 'test.txt');
      writeFileSync(filePath, 'Test content');

      const result = await executor.execute({
        type: 'tool_use',
        id: 'tool-1',
        name: 'Read',
        input: { path: filePath },
      });

      expect(result.toolUseId).toBe('tool-1');
      expect(result.content).toBe('Test content');
      expect(result.isError).toBeFalsy();
    });

    it('should execute Bash', async () => {
      const result = await executor.execute({
        type: 'tool_use',
        id: 'tool-2',
        name: 'Bash',
        input: { command: 'echo "test"' },
      });

      expect(result.toolUseId).toBe('tool-2');
      expect(result.content.trim()).toBe('test');
      expect(result.isError).toBeFalsy();
    });

    it('should error on disallowed tool', async () => {
      executor.disallowTool('Bash');

      const result = await executor.execute({
        type: 'tool_use',
        id: 'tool-3',
        name: 'Bash',
        input: { command: 'echo hello' },
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('not allowed');
    });

    it('should error on unknown tool', async () => {
      executor.allowTool('nonexistent');

      const result = await executor.execute({
        type: 'tool_use',
        id: 'tool-4',
        name: 'nonexistent',
        input: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('not found');
    });

    it('should catch executor errors', async () => {
      executor.allowTool('error_tool');
      executor.registerExecutor('error_tool', async () => {
        throw new Error('Executor failed');
      });

      const result = await executor.execute({
        type: 'tool_use',
        id: 'tool-5',
        name: 'error_tool',
        input: {},
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Executor failed');
    });
  });

  describe('executeAll', () => {
    it('should execute multiple tools in parallel', async () => {
      const file1 = join(testDir, 'file1.txt');
      const file2 = join(testDir, 'file2.txt');
      writeFileSync(file1, 'Content 1');
      writeFileSync(file2, 'Content 2');

      const toolUses = [
        { type: 'tool_use' as const, id: 'tool-1', name: 'Read', input: { path: file1 } },
        { type: 'tool_use' as const, id: 'tool-2', name: 'Read', input: { path: file2 } },
      ];

      const results = await executor.executeAll(toolUses);

      expect(results).toHaveLength(2);
      expect(results.find(r => r.name === 'Read' && r.result === 'Content 1')).toBeDefined();
      expect(results.find(r => r.name === 'Read' && r.result === 'Content 2')).toBeDefined();
    });

    it('should track duration for each tool', async () => {
      const toolUses = [
        { type: 'tool_use' as const, id: 'tool-1', name: 'Bash', input: { command: 'echo a' } },
        { type: 'tool_use' as const, id: 'tool-2', name: 'Bash', input: { command: 'echo b' } },
      ];

      const results = await executor.executeAll(toolUses);

      expect(results).toHaveLength(2);
      for (const result of results) {
        expect(typeof result.durationMs).toBe('number');
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
      }
    });

    it('should emit tool:call events', async () => {
      const calls: string[] = [];
      eventBus.on('tool:call', (payload) => {
        calls.push(payload.name);
      });

      const toolUses = [
        { type: 'tool_use' as const, id: 'tool-1', name: 'Bash', input: { command: 'echo a' } },
      ];

      await executor.executeAll(toolUses);

      expect(calls).toContain('Bash');
    });

    it('should emit tool:result events', async () => {
      const results: string[] = [];
      eventBus.on('tool:result', (payload) => {
        results.push(payload.toolUseId);
      });

      const toolUses = [
        { type: 'tool_use' as const, id: 'tool-1', name: 'Bash', input: { command: 'echo a' } },
        { type: 'tool_use' as const, id: 'tool-2', name: 'Bash', input: { command: 'echo b' } },
      ];

      await executor.executeAll(toolUses);

      expect(results).toContain('tool-1');
      expect(results).toContain('tool-2');
    });

    it('should handle mix of success and failure', async () => {
      const validFile = join(testDir, 'valid.txt');
      writeFileSync(validFile, 'Valid');

      const toolUses = [
        { type: 'tool_use' as const, id: 'tool-1', name: 'Read', input: { path: validFile } },
        { type: 'tool_use' as const, id: 'tool-2', name: 'Read', input: { path: '/nonexistent' } },
      ];

      const results = await executor.executeAll(toolUses);

      expect(results).toHaveLength(2);
      const success = results.find(r => !r.isError);
      const failure = results.find(r => r.isError);
      expect(success).toBeDefined();
      expect(failure).toBeDefined();
    });

    it('should handle empty tool list', async () => {
      const results = await executor.executeAll([]);
      expect(results).toHaveLength(0);
    });
  });

  describe('toContentBlocks', () => {
    it('should convert records to content blocks', () => {
      const records = [
        { name: 'Read', input: { path: '/test' }, result: 'content', isError: false, durationMs: 10 },
      ];
      const toolUses = [
        { type: 'tool_use' as const, id: 'tool-1', name: 'Read', input: { path: '/test' } },
      ];

      const blocks = executor.toContentBlocks(records, toolUses);

      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toEqual({
        type: 'tool_result',
        tool_use_id: 'tool-1',
        content: 'content',
        is_error: false,
      });
    });

    it('should handle error results', () => {
      const records = [
        { name: 'Read', input: {}, result: 'Error: not found', isError: true, durationMs: 5 },
      ];
      const toolUses = [
        { type: 'tool_use' as const, id: 'tool-1', name: 'Read', input: {} },
      ];

      const blocks = executor.toContentBlocks(records, toolUses);

      expect(blocks[0]?.is_error).toBe(true);
      expect(blocks[0]?.content).toContain('Error');
    });

    it('should handle missing record', () => {
      const records: any[] = [];
      const toolUses = [
        { type: 'tool_use' as const, id: 'tool-1', name: 'Read', input: {} },
      ];

      const blocks = executor.toContentBlocks(records, toolUses);

      expect(blocks[0]?.content).toContain('No result');
    });

    it('should match by tool name', () => {
      const records = [
        { name: 'Bash', input: {}, result: 'bash result', isError: false, durationMs: 10 },
        { name: 'Read', input: {}, result: 'read result', isError: false, durationMs: 5 },
      ];
      const toolUses = [
        { type: 'tool_use' as const, id: 'tool-1', name: 'Read', input: {} },
        { type: 'tool_use' as const, id: 'tool-2', name: 'Bash', input: {} },
      ];

      const blocks = executor.toContentBlocks(records, toolUses);

      expect(blocks[0]?.tool_use_id).toBe('tool-1');
      expect(blocks[0]?.content).toBe('read result');
      expect(blocks[1]?.tool_use_id).toBe('tool-2');
      expect(blocks[1]?.content).toBe('bash result');
    });
  });

  describe('getAllowedTools', () => {
    it('should return array of allowed tools', () => {
      const tools = executor.getAllowedTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('should reflect changes from allowTool/disallowTool', () => {
      const initialCount = executor.getAllowedTools().length;

      executor.allowTool('new_tool');
      expect(executor.getAllowedTools().length).toBe(initialCount + 1);

      executor.disallowTool('new_tool');
      expect(executor.getAllowedTools().length).toBe(initialCount);
    });
  });
});
