import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, chmodSync } from 'fs';
import { editTool, executeEdit } from '../../../src/core/loop/tools/edit';

describe('Edit Tool', () => {
  const testDir = join(import.meta.dir, 'test-edit-temp');

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('Tool Definition', () => {
    it('should have correct name and schema', () => {
      expect(editTool.name).toBe('Edit');
      expect(editTool.inputSchema.type).toBe('object');
      expect(editTool.inputSchema.required).toContain('file_path');
      expect(editTool.inputSchema.required).toContain('old_string');
      expect(editTool.inputSchema.required).toContain('new_string');
    });

    it('should be marked as not concurrency safe', () => {
      expect(editTool.isConcurrencySafe).toBe(false);
    });
  });

  describe('executeEdit', () => {
    it('should perform single replacement successfully', async () => {
      const filePath = join(testDir, 'single.txt');
      writeFileSync(filePath, 'Hello World, this is a test.');

      const res = await executeEdit('edit-1', {
        file_path: filePath,
        old_string: 'World',
        new_string: 'Universe',
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('Successfully replaced 1 occurrence');
      expect(readFileSync(filePath, 'utf-8')).toBe('Hello Universe, this is a test.');
    });

    it('should replace all occurrences when replace_all is true', async () => {
      const filePath = join(testDir, 'replace-all.txt');
      writeFileSync(filePath, 'foo bar foo baz foo');

      const res = await executeEdit('edit-2', {
        file_path: filePath,
        old_string: 'foo',
        new_string: 'qux',
        replace_all: true,
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('Successfully replaced 3 occurrences');
      expect(readFileSync(filePath, 'utf-8')).toBe('qux bar qux baz qux');
    });

    it('should error when old_string is not found', async () => {
      const filePath = join(testDir, 'not-found.txt');
      writeFileSync(filePath, 'Hello World');

      const res = await executeEdit('edit-3', {
        file_path: filePath,
        old_string: 'Missing',
        new_string: 'Replacement',
      });

      expect(res.isError).toBe(true);
      expect(res.content).toContain('old_string not found in file');
    });

    it('should error when old_string is ambiguous (multiple matches without replace_all)', async () => {
      const filePath = join(testDir, 'ambiguous.txt');
      writeFileSync(filePath, 'abc abc abc');

      const res = await executeEdit('edit-4', {
        file_path: filePath,
        old_string: 'abc',
        new_string: 'xyz',
      });

      expect(res.isError).toBe(true);
      expect(res.content).toContain('not unique');
      expect(res.content).toContain('3 occurrences');
      // File should be unchanged
      expect(readFileSync(filePath, 'utf-8')).toBe('abc abc abc');
    });

    it('should error when file does not exist', async () => {
      const res = await executeEdit('edit-5', {
        file_path: join(testDir, 'nonexistent.txt'),
        old_string: 'foo',
        new_string: 'bar',
      });

      expect(res.isError).toBe(true);
      expect(res.content).toContain('File not found');
    });

    it('should error when old_string equals new_string', async () => {
      const filePath = join(testDir, 'same-string.txt');
      writeFileSync(filePath, 'Hello World');

      const res = await executeEdit('edit-6', {
        file_path: filePath,
        old_string: 'Hello',
        new_string: 'Hello',
      });

      expect(res.isError).toBe(true);
      expect(res.content).toContain('identical');
    });

    it('should error when file_path is missing', async () => {
      const res = await executeEdit('edit-7', {
        old_string: 'foo',
        new_string: 'bar',
      });

      expect(res.isError).toBe(true);
      expect(res.content).toContain('file_path is required');
    });

    it('should handle multiline replacements', async () => {
      const filePath = join(testDir, 'multiline.txt');
      writeFileSync(filePath, 'line1\nline2\nline3\n');

      const res = await executeEdit('edit-8', {
        file_path: filePath,
        old_string: 'line1\nline2',
        new_string: 'replaced1\nreplaced2',
      });

      expect(res.isError).toBeFalsy();
      expect(readFileSync(filePath, 'utf-8')).toBe('replaced1\nreplaced2\nline3\n');
    });

    it('should handle special characters in strings', async () => {
      const filePath = join(testDir, 'special.txt');
      writeFileSync(filePath, 'function test() { return true; }');

      const res = await executeEdit('edit-9', {
        file_path: filePath,
        old_string: 'return true;',
        new_string: 'return false;',
      });

      expect(res.isError).toBeFalsy();
      expect(readFileSync(filePath, 'utf-8')).toBe('function test() { return false; }');
    });

    it('should handle replacement with empty string', async () => {
      const filePath = join(testDir, 'empty-replace.txt');
      writeFileSync(filePath, 'Hello World');

      const res = await executeEdit('edit-10', {
        file_path: filePath,
        old_string: ' World',
        new_string: '',
      });

      expect(res.isError).toBeFalsy();
      expect(readFileSync(filePath, 'utf-8')).toBe('Hello');
    });

    it('should handle replace_all with adjacent occurrences', async () => {
      const filePath = join(testDir, 'adjacent.txt');
      writeFileSync(filePath, 'aaa');

      const res = await executeEdit('edit-11', {
        file_path: filePath,
        old_string: 'a',
        new_string: 'bb',
        replace_all: true,
      });

      expect(res.isError).toBeFalsy();
      expect(readFileSync(filePath, 'utf-8')).toBe('bbbbbb');
    });

    it('should preserve file encoding for unicode content', async () => {
      const filePath = join(testDir, 'unicode.txt');
      const content = 'Hello \u4e16\u754c \u0414\u0440\u0443\u0437\u0456';
      writeFileSync(filePath, content);

      const res = await executeEdit('edit-12', {
        file_path: filePath,
        old_string: '\u4e16\u754c',
        new_string: 'World',
      });

      expect(res.isError).toBeFalsy();
      expect(readFileSync(filePath, 'utf-8')).toBe('Hello World \u0414\u0440\u0443\u0437\u0456');
    });

    it('should error when writing to a read-only file', async () => {
      const filePath = join(testDir, 'readonly.txt');
      writeFileSync(filePath, 'Hello World');
      chmodSync(filePath, 0o444);

      const res = await executeEdit('edit-13', {
        file_path: filePath,
        old_string: 'Hello',
        new_string: 'Goodbye',
      });

      expect(res.isError).toBe(true);
      expect(res.content).toContain('Error editing file');
      // File should be unchanged
      expect(readFileSync(filePath, 'utf-8')).toBe('Hello World');
    });
  });
});
