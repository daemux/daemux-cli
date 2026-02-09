/**
 * Tool Concurrency Safety & Whitelisting Tests
 * Tests parallel execution grouping, file-level serialization, and tool access control
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { EventBus } from '../../../src/core/event-bus';
import { ToolExecutor } from '../../../src/core/loop/executor';
import type { ToolResult } from '../../../src/core/types';

describe('Tool Concurrency Safety', () => {
  let eventBus: EventBus;
  const testDir = join(import.meta.dir, 'test-concurrency-temp');

  beforeEach(() => {
    eventBus = new EventBus();
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('Safe tools run in parallel', () => {
    it('should run multiple Read tools in parallel', async () => {
      const executor = new ToolExecutor({ eventBus });
      const file1 = join(testDir, 'read1.txt');
      const file2 = join(testDir, 'read2.txt');
      writeFileSync(file1, 'Content A');
      writeFileSync(file2, 'Content B');

      const toolUses = [
        { type: 'tool_use' as const, id: 't1', name: 'Read', input: { path: file1 } },
        { type: 'tool_use' as const, id: 't2', name: 'Read', input: { path: file2 } },
      ];

      const results = await executor.executeAll(toolUses);

      expect(results).toHaveLength(2);
      expect(results[0]!.result).toBe('Content A');
      expect(results[1]!.result).toBe('Content B');
      expect(results[0]!.isError).toBe(false);
      expect(results[1]!.isError).toBe(false);
    });

    it('should run Glob and Grep in parallel', async () => {
      const executor = new ToolExecutor({ eventBus });
      const file = join(testDir, 'search.ts');
      writeFileSync(file, 'function hello() { return 42; }');

      const toolUses = [
        { type: 'tool_use' as const, id: 't1', name: 'Glob', input: { pattern: '*.ts', path: testDir } },
        { type: 'tool_use' as const, id: 't2', name: 'Grep', input: { pattern: 'hello', path: testDir } },
      ];

      const results = await executor.executeAll(toolUses);

      expect(results).toHaveLength(2);
      expect(results[0]!.isError).toBe(false);
      expect(results[1]!.isError).toBe(false);
    });

    it('should run Bash commands in parallel', async () => {
      const executor = new ToolExecutor({ eventBus });
      const toolUses = [
        { type: 'tool_use' as const, id: 't1', name: 'Bash', input: { command: 'echo alpha' } },
        { type: 'tool_use' as const, id: 't2', name: 'Bash', input: { command: 'echo beta' } },
      ];

      const results = await executor.executeAll(toolUses);

      expect(results).toHaveLength(2);
      expect(results[0]!.result.trim()).toBe('alpha');
      expect(results[1]!.result.trim()).toBe('beta');
    });
  });

  describe('Unsafe tools targeting same file run sequentially', () => {
    it('should serialize Edit operations on the same file', async () => {
      const executor = new ToolExecutor({ eventBus });
      const filePath = join(testDir, 'sequential.txt');
      writeFileSync(filePath, 'line1\nline2\nline3');

      // Two edits on the same file: first replaces line1, second replaces line2
      const toolUses = [
        {
          type: 'tool_use' as const, id: 't1', name: 'Edit',
          input: { file_path: filePath, old_string: 'line1', new_string: 'FIRST' },
        },
        {
          type: 'tool_use' as const, id: 't2', name: 'Edit',
          input: { file_path: filePath, old_string: 'line2', new_string: 'SECOND' },
        },
      ];

      const results = await executor.executeAll(toolUses);

      expect(results[0]!.isError).toBe(false);
      expect(results[1]!.isError).toBe(false);

      const finalContent = readFileSync(filePath, 'utf-8');
      expect(finalContent).toBe('FIRST\nSECOND\nline3');
    });

    it('should serialize Write operations on the same file', async () => {
      const executor = new ToolExecutor({ eventBus });
      const filePath = join(testDir, 'write-serial.txt');

      // Two writes to same file should be sequential - last one wins
      const toolUses = [
        {
          type: 'tool_use' as const, id: 't1', name: 'Write',
          input: { path: filePath, content: 'first write' },
        },
        {
          type: 'tool_use' as const, id: 't2', name: 'Write',
          input: { path: filePath, content: 'second write' },
        },
      ];

      const results = await executor.executeAll(toolUses);

      expect(results[0]!.isError).toBe(false);
      expect(results[1]!.isError).toBe(false);

      // Because they're serialized, second write should be the final content
      const finalContent = readFileSync(filePath, 'utf-8');
      expect(finalContent).toBe('second write');
    });

    it('should track execution order for same-file unsafe tools', async () => {
      const executor = new ToolExecutor({ eventBus });
      const filePath = join(testDir, 'order-track.txt');
      writeFileSync(filePath, 'original');

      const executionOrder: string[] = [];

      // Register custom executors that track order
      executor.registerExecutor('Edit', async (id, input) => {
        executionOrder.push(id);
        // Small delay to verify serialization
        await new Promise(r => setTimeout(r, 20));
        const content = readFileSync(filePath, 'utf-8');
        const newContent = content + `_${id}`;
        writeFileSync(filePath, newContent);
        return { toolUseId: id, content: `Edited: ${id}`, isError: false };
      });

      const toolUses = [
        {
          type: 'tool_use' as const, id: 'edit-1', name: 'Edit',
          input: { file_path: filePath, old_string: 'x', new_string: 'y' },
        },
        {
          type: 'tool_use' as const, id: 'edit-2', name: 'Edit',
          input: { file_path: filePath, old_string: 'a', new_string: 'b' },
        },
        {
          type: 'tool_use' as const, id: 'edit-3', name: 'Edit',
          input: { file_path: filePath, old_string: 'c', new_string: 'd' },
        },
      ];

      await executor.executeAll(toolUses);

      // Verify sequential order
      expect(executionOrder).toEqual(['edit-1', 'edit-2', 'edit-3']);

      // Verify file content reflects sequential execution
      const finalContent = readFileSync(filePath, 'utf-8');
      expect(finalContent).toBe('original_edit-1_edit-2_edit-3');
    });
  });

  describe('Unsafe tools targeting different files run in parallel', () => {
    it('should run Edit operations on different files in parallel', async () => {
      const executor = new ToolExecutor({ eventBus });
      const fileA = join(testDir, 'diff-a.txt');
      const fileB = join(testDir, 'diff-b.txt');
      writeFileSync(fileA, 'alpha');
      writeFileSync(fileB, 'beta');

      const startTimes: Record<string, number> = {};
      const endTimes: Record<string, number> = {};

      executor.registerExecutor('Edit', async (id, input) => {
        startTimes[id] = Date.now();
        await new Promise(r => setTimeout(r, 50));
        const fp = input.file_path as string;
        writeFileSync(fp, `edited-${id}`);
        endTimes[id] = Date.now();
        return { toolUseId: id, content: `Edited ${id}`, isError: false };
      });

      const toolUses = [
        {
          type: 'tool_use' as const, id: 'a1', name: 'Edit',
          input: { file_path: fileA, old_string: 'x', new_string: 'y' },
        },
        {
          type: 'tool_use' as const, id: 'b1', name: 'Edit',
          input: { file_path: fileB, old_string: 'x', new_string: 'y' },
        },
      ];

      const before = Date.now();
      await executor.executeAll(toolUses);
      const totalTime = Date.now() - before;

      // Both files should be edited
      expect(readFileSync(fileA, 'utf-8')).toBe('edited-a1');
      expect(readFileSync(fileB, 'utf-8')).toBe('edited-b1');

      // Total time should be close to 50ms, not 100ms, proving parallelism
      // Allow some overhead but should be well under 100ms sequential time
      expect(totalTime).toBeLessThan(90);
    });
  });

  describe('Mixed safe and unsafe tools', () => {
    it('should run safe tools in parallel with unsafe tools', async () => {
      const executor = new ToolExecutor({ eventBus });
      const fileToEdit = join(testDir, 'mixed.txt');
      const fileToRead = join(testDir, 'readable.txt');
      writeFileSync(fileToEdit, 'edit-me');
      writeFileSync(fileToRead, 'read-me');

      const toolUses = [
        { type: 'tool_use' as const, id: 't1', name: 'Read', input: { path: fileToRead } },
        {
          type: 'tool_use' as const, id: 't2', name: 'Edit',
          input: { file_path: fileToEdit, old_string: 'edit-me', new_string: 'edited' },
        },
        { type: 'tool_use' as const, id: 't3', name: 'Bash', input: { command: 'echo parallel' } },
      ];

      const results = await executor.executeAll(toolUses);

      expect(results).toHaveLength(3);
      // Results should be in the same order as input
      expect(results[0]!.name).toBe('Read');
      expect(results[0]!.result).toBe('read-me');
      expect(results[1]!.name).toBe('Edit');
      expect(results[1]!.isError).toBe(false);
      expect(results[2]!.name).toBe('Bash');
      expect(results[2]!.result.trim()).toBe('parallel');
    });

    it('should preserve result order regardless of execution order', async () => {
      const executor = new ToolExecutor({ eventBus });
      const file = join(testDir, 'order.txt');
      writeFileSync(file, 'content');

      // Mix of fast and slow tools
      executor.registerExecutor('Bash', async (id) => {
        await new Promise(r => setTimeout(r, 30));
        return { toolUseId: id, content: 'bash-done', isError: false };
      });

      const toolUses = [
        { type: 'tool_use' as const, id: 't0', name: 'Bash', input: { command: 'sleep 0.03' } },
        { type: 'tool_use' as const, id: 't1', name: 'Read', input: { path: file } },
      ];

      const results = await executor.executeAll(toolUses);

      // Order should match input, not execution completion
      expect(results[0]!.name).toBe('Bash');
      expect(results[1]!.name).toBe('Read');
    });
  });

  describe('Empty and single tool cases', () => {
    it('should handle empty tool list', async () => {
      const executor = new ToolExecutor({ eventBus });
      const results = await executor.executeAll([]);
      expect(results).toHaveLength(0);
    });

    it('should handle single safe tool', async () => {
      const executor = new ToolExecutor({ eventBus });
      const file = join(testDir, 'single.txt');
      writeFileSync(file, 'solo');

      const results = await executor.executeAll([
        { type: 'tool_use' as const, id: 't1', name: 'Read', input: { path: file } },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0]!.result).toBe('solo');
    });

    it('should handle single unsafe tool', async () => {
      const executor = new ToolExecutor({ eventBus });
      const file = join(testDir, 'single-unsafe.txt');
      writeFileSync(file, 'old content');

      const results = await executor.executeAll([
        {
          type: 'tool_use' as const, id: 't1', name: 'Edit',
          input: { file_path: file, old_string: 'old content', new_string: 'new content' },
        },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0]!.isError).toBe(false);
      expect(readFileSync(file, 'utf-8')).toBe('new content');
    });
  });
});

describe('Tool Whitelisting', () => {
  let eventBus: EventBus;
  const testDir = join(import.meta.dir, 'test-whitelist-temp');

  beforeEach(() => {
    eventBus = new EventBus();
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('Whitelisting blocks disallowed tools', () => {
    it('should block tool not in allowedTools', async () => {
      const executor = new ToolExecutor({
        eventBus,
        allowedTools: ['Read', 'Glob'],
      });

      const result = await executor.execute({
        type: 'tool_use', id: 't1', name: 'Edit',
        input: { file_path: '/tmp/test.txt', old_string: 'a', new_string: 'b' },
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("Tool 'Edit' is not allowed");
    });

    it('should block Bash when not in allowedTools', async () => {
      const executor = new ToolExecutor({
        eventBus,
        allowedTools: ['Read'],
      });

      const result = await executor.execute({
        type: 'tool_use', id: 't1', name: 'Bash',
        input: { command: 'echo hacked' },
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("Tool 'Bash' is not allowed");
    });

    it('should block Write when not in allowedTools', async () => {
      const executor = new ToolExecutor({
        eventBus,
        allowedTools: ['Read', 'Glob', 'Grep'],
      });

      const result = await executor.execute({
        type: 'tool_use', id: 't1', name: 'Write',
        input: { path: '/tmp/evil.txt', content: 'evil' },
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain("Tool 'Write' is not allowed");
    });
  });

  describe('Whitelisting in executeAll', () => {
    it('should reject disallowed tools in batch execution', async () => {
      const executor = new ToolExecutor({
        eventBus,
        allowedTools: ['Read'],
      });

      const file = join(testDir, 'batch.txt');
      writeFileSync(file, 'readable');

      const toolUses = [
        { type: 'tool_use' as const, id: 't1', name: 'Read', input: { path: file } },
        { type: 'tool_use' as const, id: 't2', name: 'Bash', input: { command: 'echo no' } },
        {
          type: 'tool_use' as const, id: 't3', name: 'Edit',
          input: { file_path: file, old_string: 'readable', new_string: 'hacked' },
        },
      ];

      const results = await executor.executeAll(toolUses);

      expect(results).toHaveLength(3);
      // Read should succeed
      expect(results[0]!.isError).toBe(false);
      expect(results[0]!.result).toBe('readable');
      // Bash should be blocked
      expect(results[1]!.isError).toBe(true);
      expect(results[1]!.result).toContain('not allowed');
      // Edit should be blocked
      expect(results[2]!.isError).toBe(true);
      expect(results[2]!.result).toContain('not allowed');

      // File should remain unchanged
      expect(readFileSync(file, 'utf-8')).toBe('readable');
    });

    it('should handle all tools being blocked', async () => {
      const executor = new ToolExecutor({
        eventBus,
        allowedTools: ['SomeOtherTool'],
      });

      const results = await executor.executeAll([
        { type: 'tool_use' as const, id: 't1', name: 'Read', input: { path: '/tmp/x' } },
        { type: 'tool_use' as const, id: 't2', name: 'Bash', input: { command: 'echo nope' } },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0]!.isError).toBe(true);
      expect(results[1]!.isError).toBe(true);
    });
  });

  describe('Empty allowedTools allows all tools', () => {
    it('should allow all built-in tools when no explicit allowedTools set', async () => {
      const executor = new ToolExecutor({ eventBus });
      const file = join(testDir, 'default.txt');
      writeFileSync(file, 'default content');

      // All tools should work
      expect(executor.isAllowed('Read')).toBe(true);
      expect(executor.isAllowed('Write')).toBe(true);
      expect(executor.isAllowed('Bash')).toBe(true);
      expect(executor.isAllowed('Edit')).toBe(true);
      expect(executor.isAllowed('Glob')).toBe(true);
      expect(executor.isAllowed('Grep')).toBe(true);

      const result = await executor.execute({
        type: 'tool_use', id: 't1', name: 'Read', input: { path: file },
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toBe('default content');
    });
  });

  describe('Rejected tool returns proper error result', () => {
    it('should return isError true for rejected tools', async () => {
      const executor = new ToolExecutor({
        eventBus,
        allowedTools: ['Read'],
      });

      const result = await executor.execute({
        type: 'tool_use', id: 'reject-1', name: 'Write',
        input: { path: '/tmp/test', content: 'data' },
      });

      expect(result.toolUseId).toBe('reject-1');
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/Tool 'Write' is not allowed/);
    });

    it('should include tool name in rejection message', async () => {
      const executor = new ToolExecutor({
        eventBus,
        allowedTools: ['Glob'],
      });

      const result = await executor.execute({
        type: 'tool_use', id: 'reject-2', name: 'Bash',
        input: { command: 'rm -rf /' },
      });

      expect(result.content).toContain("'Bash'");
      expect(result.content).toContain('not allowed');
    });

    it('should return durationMs of 0 for rejected tools in executeAll', async () => {
      const executor = new ToolExecutor({
        eventBus,
        allowedTools: ['Read'],
      });

      const results = await executor.executeAll([
        { type: 'tool_use' as const, id: 't1', name: 'Write', input: { path: '/tmp/x', content: 'x' } },
      ]);

      expect(results[0]!.durationMs).toBe(0);
      expect(results[0]!.isError).toBe(true);
    });
  });

  describe('Dynamic tool allow/disallow', () => {
    it('should allow newly added tool', async () => {
      const executor = new ToolExecutor({
        eventBus,
        allowedTools: ['Read'],
      });

      expect(executor.isAllowed('Bash')).toBe(false);

      executor.allowTool('Bash');
      expect(executor.isAllowed('Bash')).toBe(true);

      const result = await executor.execute({
        type: 'tool_use', id: 't1', name: 'Bash',
        input: { command: 'echo allowed' },
      });

      expect(result.isError).toBeFalsy();
      expect(result.content.trim()).toBe('allowed');
    });

    it('should block previously allowed tool after disallow', async () => {
      const executor = new ToolExecutor({ eventBus });

      expect(executor.isAllowed('Bash')).toBe(true);
      executor.disallowTool('Bash');

      const result = await executor.execute({
        type: 'tool_use', id: 't1', name: 'Bash',
        input: { command: 'echo blocked' },
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('not allowed');
    });
  });
});
