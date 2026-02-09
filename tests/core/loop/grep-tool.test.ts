import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { grepTool, executeGrep, nativeFallback } from '../../../src/core/loop/tools/grep';

describe('Grep Tool', () => {
  const testDir = join(import.meta.dir, 'test-grep-temp');

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
      expect(grepTool.name).toBe('Grep');
      expect(grepTool.inputSchema.type).toBe('object');
      expect(grepTool.inputSchema.required).toContain('pattern');
    });

    it('should be marked as concurrency safe', () => {
      expect(grepTool.isConcurrencySafe).toBe(true);
    });
  });

  describe('executeGrep', () => {
    it('should find basic regex pattern matches', async () => {
      writeFileSync(join(testDir, 'test.ts'), 'const foo = 1;\nconst bar = 2;\nconst fooBar = 3;\n');

      const res = await executeGrep('grep-1', {
        pattern: 'foo',
        path: testDir,
        output_mode: 'content',
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('foo');
    });

    it('should return files_with_matches output mode', async () => {
      writeFileSync(join(testDir, 'match.ts'), 'const hello = 1;');
      writeFileSync(join(testDir, 'nomatch.ts'), 'const world = 2;');

      const res = await executeGrep('grep-2', {
        pattern: 'hello',
        path: testDir,
        output_mode: 'files_with_matches',
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('match.ts');
      expect(res.content).not.toContain('nomatch.ts');
    });

    it('should return count output mode', async () => {
      writeFileSync(join(testDir, 'counted.ts'), 'foo\nbar\nfoo\nbaz\nfoo\n');

      const res = await executeGrep('grep-3', {
        pattern: 'foo',
        path: testDir,
        output_mode: 'count',
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('counted.ts');
      // Should contain a count of 3
      expect(res.content).toContain('3');
    });

    it('should filter files using glob parameter', async () => {
      writeFileSync(join(testDir, 'code.ts'), 'const value = 42;');
      writeFileSync(join(testDir, 'code.js'), 'const value = 42;');
      writeFileSync(join(testDir, 'readme.md'), 'value is 42');

      const res = await executeGrep('grep-4', {
        pattern: 'value',
        path: testDir,
        glob: '*.ts',
        output_mode: 'files_with_matches',
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('code.ts');
      expect(res.content).not.toContain('code.js');
      expect(res.content).not.toContain('readme.md');
    });

    it('should include context lines', async () => {
      writeFileSync(join(testDir, 'context.ts'), 'line1\nline2\ntarget\nline4\nline5\n');

      const res = await executeGrep('grep-5', {
        pattern: 'target',
        path: testDir,
        output_mode: 'content',
        context: 1,
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('target');
      // With context, should also show surrounding lines
      expect(res.content).toContain('line2');
      expect(res.content).toContain('line4');
    });

    it('should return "No matches found" when pattern not found', async () => {
      writeFileSync(join(testDir, 'empty.ts'), 'no matches here');

      const res = await executeGrep('grep-6', {
        pattern: 'zzz_nonexistent_zzz',
        path: testDir,
        output_mode: 'content',
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('No matches found');
    });

    it('should handle multiline mode', async () => {
      writeFileSync(join(testDir, 'multi.ts'), 'start\nmiddle\nend');

      const res = await executeGrep('grep-7', {
        pattern: 'start.*end',
        path: testDir,
        output_mode: 'files_with_matches',
        multiline: true,
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('multi.ts');
    });

    it('should error when pattern is missing', async () => {
      const res = await executeGrep('grep-8', {});

      expect(res.isError).toBe(true);
      expect(res.content).toContain('pattern is required');
    });

    it('should search in nested directories', async () => {
      mkdirSync(join(testDir, 'src', 'core'), { recursive: true });
      writeFileSync(join(testDir, 'src', 'core', 'deep.ts'), 'function deepSearch() {}');

      const res = await executeGrep('grep-9', {
        pattern: 'deepSearch',
        path: testDir,
        output_mode: 'files_with_matches',
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('deep.ts');
    });

    it('should handle regex special characters in pattern', async () => {
      writeFileSync(join(testDir, 'regex.ts'), 'const arr = [1, 2, 3];\nconst obj = {a: 1};\n');

      const res = await executeGrep('grep-10', {
        pattern: '\\[1,\\s*2',
        path: testDir,
        output_mode: 'content',
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('[1, 2');
    });

    it('should skip binary files in native fallback', async () => {
      writeFileSync(join(testDir, 'code.ts'), 'searchable text');
      writeFileSync(join(testDir, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      const res = await executeGrep('grep-11', {
        pattern: 'searchable',
        path: testDir,
        output_mode: 'files_with_matches',
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('code.ts');
      expect(res.content).not.toContain('image.png');
    });

    it('should use default output_mode of files_with_matches', async () => {
      writeFileSync(join(testDir, 'default.ts'), 'test content');

      const res = await executeGrep('grep-12', {
        pattern: 'test',
        path: testDir,
      });

      expect(res.isError).toBeFalsy();
      // Should return file paths, not content with line numbers
      expect(res.content).toContain('default.ts');
    });

    it('should truncate output exceeding 30000 characters', async () => {
      // Generate a file with many lines so grep output exceeds 30000 chars
      const longLine = 'match_' + 'x'.repeat(200) + '\n';
      const content = longLine.repeat(200);
      writeFileSync(join(testDir, 'huge.ts'), content);

      const res = await executeGrep('grep-trunc', {
        pattern: 'match_',
        path: testDir,
        output_mode: 'content',
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('output truncated at 30000 characters');
    });
  });

  describe('nativeFallback', () => {
    it('should find matches in files_with_matches mode', () => {
      writeFileSync(join(testDir, 'native.ts'), 'const hello = 1;');
      writeFileSync(join(testDir, 'other.ts'), 'const world = 2;');

      const res = nativeFallback('nf-1', 'hello', testDir, {
        outputMode: 'files_with_matches',
        multiline: false,
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('native.ts');
      expect(res.content).not.toContain('other.ts');
    });

    it('should return content mode with line numbers', () => {
      writeFileSync(join(testDir, 'lines.ts'), 'aaa\nbbb\nccc\n');

      const res = nativeFallback('nf-2', 'bbb', testDir, {
        outputMode: 'content',
        multiline: false,
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('lines.ts:2:bbb');
    });

    it('should return count mode', () => {
      writeFileSync(join(testDir, 'counted.ts'), 'foo\nbar\nfoo\nbaz\nfoo\n');

      const res = nativeFallback('nf-3', 'foo', testDir, {
        outputMode: 'count',
        multiline: false,
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('counted.ts:3');
    });

    it('should return "No matches found" when nothing matches', () => {
      writeFileSync(join(testDir, 'empty.ts'), 'nothing here');

      const res = nativeFallback('nf-4', 'zzz_missing_zzz', testDir, {
        outputMode: 'files_with_matches',
        multiline: false,
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('No matches found');
    });

    it('should include context lines in content mode', () => {
      writeFileSync(join(testDir, 'ctx.ts'), 'line1\nline2\ntarget\nline4\nline5\n');

      const res = nativeFallback('nf-5', 'target', testDir, {
        outputMode: 'content',
        multiline: false,
        context: 1,
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('line2');
      expect(res.content).toContain('target');
      expect(res.content).toContain('line4');
    });

    it('should support multiline matching', () => {
      writeFileSync(join(testDir, 'ml.ts'), 'start\nmiddle\nend');

      const res = nativeFallback('nf-6', 'start.*end', testDir, {
        outputMode: 'files_with_matches',
        multiline: true,
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('ml.ts');
    });

    it('should filter with multi-segment glob pattern', () => {
      mkdirSync(join(testDir, 'src', 'core'), { recursive: true });
      mkdirSync(join(testDir, 'lib'), { recursive: true });
      writeFileSync(join(testDir, 'src', 'core', 'deep.ts'), 'findme');
      writeFileSync(join(testDir, 'lib', 'shallow.ts'), 'findme');

      const res = nativeFallback('nf-7', 'findme', testDir, {
        glob: 'src/**/*.ts',
        outputMode: 'files_with_matches',
        multiline: false,
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('deep.ts');
      expect(res.content).not.toContain('shallow.ts');
    });

    it('should skip binary files even when glob matches them', () => {
      writeFileSync(join(testDir, 'code.ts'), 'searchable text');
      writeFileSync(join(testDir, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      const res = nativeFallback('nf-8', 'searchable', testDir, {
        glob: '*',
        outputMode: 'files_with_matches',
        multiline: false,
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('code.ts');
      expect(res.content).not.toContain('image.png');
    });

    it('should handle invalid regex gracefully', () => {
      writeFileSync(join(testDir, 'any.ts'), 'content');

      const res = nativeFallback('nf-9', '[invalid', testDir, {
        outputMode: 'files_with_matches',
        multiline: false,
      });

      expect(res.isError).toBe(true);
      expect(res.content).toContain('Error running native grep');
    });

    it('should search nested directories', () => {
      mkdirSync(join(testDir, 'a', 'b', 'c'), { recursive: true });
      writeFileSync(join(testDir, 'a', 'b', 'c', 'nested.ts'), 'deep_value');

      const res = nativeFallback('nf-10', 'deep_value', testDir, {
        outputMode: 'files_with_matches',
        multiline: false,
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('nested.ts');
    });
  });
});
