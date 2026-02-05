/**
 * Built-in Tools Unit Tests
 * Tests Read, Write, and Bash tools
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import {
  readFileTool,
  writeFileTool,
  bashTool,
  executeReadFile,
  executeWriteFile,
  executeBash,
  BUILTIN_TOOLS,
  getToolExecutor,
  registerToolExecutor,
} from '../../../src/core/loop/tools';

describe('Built-in Tools', () => {
  const testDir = join(import.meta.dir, 'test-tools-temp');

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('Tool Definitions', () => {
    it('should export correct tool definitions', () => {
      expect(BUILTIN_TOOLS).toHaveLength(3);
      expect(BUILTIN_TOOLS.map(t => t.name)).toContain('Read');
      expect(BUILTIN_TOOLS.map(t => t.name)).toContain('Write');
      expect(BUILTIN_TOOLS.map(t => t.name)).toContain('Bash');
    });

    it('Read tool should have correct schema', () => {
      expect(readFileTool.name).toBe('Read');
      expect(readFileTool.description).toContain('Read');
      expect(readFileTool.inputSchema.type).toBe('object');
      expect(readFileTool.inputSchema.required).toContain('path');
    });

    it('Write tool should have correct schema', () => {
      expect(writeFileTool.name).toBe('Write');
      expect(writeFileTool.description).toContain('Write');
      expect(writeFileTool.inputSchema.type).toBe('object');
      expect(writeFileTool.inputSchema.required).toContain('path');
      expect(writeFileTool.inputSchema.required).toContain('content');
    });

    it('Bash tool should have correct schema', () => {
      expect(bashTool.name).toBe('Bash');
      expect(bashTool.description).toContain('bash');
      expect(bashTool.inputSchema.type).toBe('object');
      expect(bashTool.inputSchema.required).toContain('command');
    });
  });

  describe('executeReadFile', () => {
    it('should read file content', async () => {
      const filePath = join(testDir, 'test-read.txt');
      writeFileSync(filePath, 'Hello, World!');

      const result = await executeReadFile('tool-1', { path: filePath });

      expect(result.toolUseId).toBe('tool-1');
      expect(result.content).toBe('Hello, World!');
      expect(result.isError).toBeFalsy();
    });

    it('should handle different encoding', async () => {
      const filePath = join(testDir, 'test-encoding.txt');
      writeFileSync(filePath, 'Content with encoding');

      const result = await executeReadFile('tool-2', { path: filePath, encoding: 'utf-8' });

      expect(result.content).toBe('Content with encoding');
      expect(result.isError).toBeFalsy();
    });

    it('should error on missing path', async () => {
      const result = await executeReadFile('tool-3', {});

      expect(result.isError).toBe(true);
      expect(result.content).toContain('path is required');
    });

    it('should error on non-existent file', async () => {
      const result = await executeReadFile('tool-4', { path: '/non/existent/file.txt' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('not found');
    });

    it('should handle relative paths', async () => {
      mkdirSync(testDir, { recursive: true });
      writeFileSync(join(testDir, 'relative-test.txt'), 'Relative content');

      const result = await executeReadFile('tool-5', { path: join(testDir, 'relative-test.txt') });

      expect(result.isError).toBeFalsy();
      expect(result.content).toBe('Relative content');
    });

    it('should read large files', async () => {
      const filePath = join(testDir, 'large-file.txt');
      const largeContent = 'x'.repeat(100000);
      writeFileSync(filePath, largeContent);

      const result = await executeReadFile('tool-6', { path: filePath });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(100000);
    });

    it('should read file with special characters', async () => {
      const filePath = join(testDir, 'special-chars.txt');
      const content = 'Line 1\nLine 2\tTab\rCarriage\nUnicode: \u00e9\u00e8\u00ea';
      writeFileSync(filePath, content);

      const result = await executeReadFile('tool-7', { path: filePath });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('Line 1');
      expect(result.content).toContain('Unicode');
    });
  });

  describe('executeWriteFile', () => {
    it('should write file content', async () => {
      const filePath = join(testDir, 'test-write.txt');

      const result = await executeWriteFile('tool-1', {
        path: filePath,
        content: 'Written content',
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toContain('successfully');
      expect(readFileSync(filePath, 'utf-8')).toBe('Written content');
    });

    it('should create parent directories', async () => {
      const filePath = join(testDir, 'nested', 'deep', 'file.txt');

      const result = await executeWriteFile('tool-2', {
        path: filePath,
        content: 'Nested content',
      });

      expect(result.isError).toBeFalsy();
      expect(existsSync(filePath)).toBe(true);
      expect(readFileSync(filePath, 'utf-8')).toBe('Nested content');
    });

    it('should error on missing path', async () => {
      const result = await executeWriteFile('tool-3', { content: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('path is required');
    });

    it('should error on missing content', async () => {
      const result = await executeWriteFile('tool-4', { path: '/tmp/test.txt' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('content is required');
    });

    it('should overwrite existing file', async () => {
      const filePath = join(testDir, 'overwrite.txt');
      writeFileSync(filePath, 'Original content');

      const result = await executeWriteFile('tool-5', {
        path: filePath,
        content: 'New content',
      });

      expect(result.isError).toBeFalsy();
      expect(readFileSync(filePath, 'utf-8')).toBe('New content');
    });

    it('should handle empty content', async () => {
      const filePath = join(testDir, 'empty.txt');

      const result = await executeWriteFile('tool-6', {
        path: filePath,
        content: '',
      });

      expect(result.isError).toBeFalsy();
      expect(readFileSync(filePath, 'utf-8')).toBe('');
    });

    it('should handle unicode content', async () => {
      const filePath = join(testDir, 'unicode.txt');
      const unicodeContent = 'Hello \u4e16\u754c \u0414\u0440\u0443\u0437\u0456';

      const result = await executeWriteFile('tool-7', {
        path: filePath,
        content: unicodeContent,
      });

      expect(result.isError).toBeFalsy();
      expect(readFileSync(filePath, 'utf-8')).toBe(unicodeContent);
    });
  });

  describe('executeBash', () => {
    it('should execute simple command', async () => {
      const result = await executeBash('tool-1', { command: 'echo "Hello"' });

      expect(result.isError).toBeFalsy();
      expect(result.content.trim()).toBe('Hello');
    });

    it('should error on missing command', async () => {
      const result = await executeBash('tool-2', {});

      expect(result.isError).toBe(true);
      expect(result.content).toContain('command is required');
    });

    it('should handle command failure', async () => {
      const result = await executeBash('tool-3', { command: 'exit 1' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Exit code 1');
    });

    it('should capture stderr', async () => {
      const result = await executeBash('tool-4', { command: 'echo "error" >&2' });

      expect(result.content).toContain('error');
    });

    it('should respect working directory', async () => {
      const result = await executeBash('tool-5', {
        command: 'pwd',
        cwd: testDir,
      });

      expect(result.isError).toBeFalsy();
      expect(result.content.trim()).toBe(testDir);
    });

    it('should handle command with pipes', async () => {
      const result = await executeBash('tool-6', {
        command: 'echo "hello world" | tr a-z A-Z',
      });

      expect(result.isError).toBeFalsy();
      expect(result.content.trim()).toBe('HELLO WORLD');
    });

    it('should handle no output', async () => {
      const result = await executeBash('tool-7', { command: 'true' });

      expect(result.isError).toBeFalsy();
      expect(result.content).toBe('(no output)');
    });

    it('should timeout long commands', async () => {
      const result = await executeBash('tool-8', {
        command: 'sleep 10',
        timeout: 100,
      });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('timed out');
    });

    it('should handle command with environment', async () => {
      const result = await executeBash('tool-9', {
        command: 'echo $TEST_VAR',
      });

      expect(result.isError).toBeFalsy();
    });

    it('should execute multi-line scripts', async () => {
      const result = await executeBash('tool-10', {
        command: 'a=1\nb=2\necho $((a+b))',
      });

      expect(result.isError).toBeFalsy();
      expect(result.content.trim()).toBe('3');
    });
  });

  describe('Tool Registry', () => {
    it('should get executor for Read', () => {
      const executor = getToolExecutor('Read');
      expect(executor).toBeDefined();
      expect(typeof executor).toBe('function');
    });

    it('should get executor for Write', () => {
      const executor = getToolExecutor('Write');
      expect(executor).toBeDefined();
      expect(typeof executor).toBe('function');
    });

    it('should get executor for Bash', () => {
      const executor = getToolExecutor('Bash');
      expect(executor).toBeDefined();
      expect(typeof executor).toBe('function');
    });

    it('should return undefined for unknown tool', () => {
      const executor = getToolExecutor('unknown_tool');
      expect(executor).toBeUndefined();
    });

    it('should register custom tool executor', async () => {
      const customExecutor = async (id: string, input: Record<string, unknown>) => ({
        toolUseId: id,
        content: `Custom: ${input.value}`,
        isError: false,
      });

      registerToolExecutor('custom_tool', customExecutor);

      const executor = getToolExecutor('custom_tool');
      expect(executor).toBeDefined();

      const result = await executor!('test-id', { value: 'test' });
      expect(result.content).toBe('Custom: test');
    });
  });
});
