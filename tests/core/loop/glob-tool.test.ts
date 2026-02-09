import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync, utimesSync } from 'fs';
import { globTool, executeGlob } from '../../../src/core/loop/tools/glob';

describe('Glob Tool', () => {
  const testDir = join(import.meta.dir, 'test-glob-temp');

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
      expect(globTool.name).toBe('Glob');
      expect(globTool.inputSchema.type).toBe('object');
      expect(globTool.inputSchema.required).toContain('pattern');
    });

    it('should be marked as concurrency safe', () => {
      expect(globTool.isConcurrencySafe).toBe(true);
    });
  });

  describe('executeGlob', () => {
    it('should match .ts files', async () => {
      writeFileSync(join(testDir, 'file1.ts'), 'content1');
      writeFileSync(join(testDir, 'file2.ts'), 'content2');
      writeFileSync(join(testDir, 'file3.js'), 'content3');

      const res = await executeGlob('glob-1', {
        pattern: '*.ts',
        path: testDir,
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('file1.ts');
      expect(res.content).toContain('file2.ts');
      expect(res.content).not.toContain('file3.js');
    });

    it('should match files in nested directories', async () => {
      mkdirSync(join(testDir, 'src', 'core'), { recursive: true });
      writeFileSync(join(testDir, 'src', 'index.ts'), 'root');
      writeFileSync(join(testDir, 'src', 'core', 'loop.ts'), 'nested');

      const res = await executeGlob('glob-2', {
        pattern: '**/*.ts',
        path: testDir,
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('index.ts');
      expect(res.content).toContain('loop.ts');
    });

    it('should return message when no matches found', async () => {
      writeFileSync(join(testDir, 'file.txt'), 'content');

      const res = await executeGlob('glob-3', {
        pattern: '*.py',
        path: testDir,
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('No files matched pattern: *.py');
    });

    it('should use custom path parameter', async () => {
      const subDir = join(testDir, 'subdir');
      mkdirSync(subDir, { recursive: true });
      writeFileSync(join(subDir, 'nested.ts'), 'content');
      writeFileSync(join(testDir, 'root.ts'), 'content');

      const res = await executeGlob('glob-4', {
        pattern: '*.ts',
        path: subDir,
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('nested.ts');
      expect(res.content).not.toContain('root.ts');
    });

    it('should sort results by mtime (most recent first)', async () => {
      const file1 = join(testDir, 'old.ts');
      const file2 = join(testDir, 'new.ts');

      writeFileSync(file1, 'old content');
      // Set old mtime
      const oldTime = new Date('2020-01-01T00:00:00Z');
      utimesSync(file1, oldTime, oldTime);

      writeFileSync(file2, 'new content');
      // Set recent mtime
      const newTime = new Date('2025-01-01T00:00:00Z');
      utimesSync(file2, newTime, newTime);

      const res = await executeGlob('glob-5', {
        pattern: '*.ts',
        path: testDir,
      });

      expect(res.isError).toBeFalsy();
      const lines = res.content.split('\n');
      expect(lines[0]).toContain('new.ts');
      expect(lines[1]).toContain('old.ts');
    });

    it('should error when pattern is missing', async () => {
      const res = await executeGlob('glob-6', {});

      expect(res.isError).toBe(true);
      expect(res.content).toContain('pattern is required');
    });

    it('should handle multiple file extensions', async () => {
      writeFileSync(join(testDir, 'app.ts'), 'ts');
      writeFileSync(join(testDir, 'style.css'), 'css');
      writeFileSync(join(testDir, 'readme.md'), 'md');

      const res = await executeGlob('glob-7', {
        pattern: '*.{ts,css}',
        path: testDir,
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('app.ts');
      expect(res.content).toContain('style.css');
      expect(res.content).not.toContain('readme.md');
    });

    it('should handle empty directory', async () => {
      const emptyDir = join(testDir, 'empty');
      mkdirSync(emptyDir, { recursive: true });

      const res = await executeGlob('glob-8', {
        pattern: '*.ts',
        path: emptyDir,
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('No files matched');
    });
  });
});
