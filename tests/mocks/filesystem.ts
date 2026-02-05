/**
 * Mock File System
 * In-memory file system for testing file operations
 */

import { join, dirname, basename, resolve as resolvePath } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MockFile {
  content: string | Buffer;
  mode: number;
  createdAt: number;
  modifiedAt: number;
}

export interface MockDirectory {
  mode: number;
  createdAt: number;
}

export interface FSOperation {
  type: 'read' | 'write' | 'delete' | 'mkdir' | 'chmod' | 'stat' | 'exists';
  path: string;
  timestamp: number;
  data?: unknown;
}

// ---------------------------------------------------------------------------
// Mock File System
// ---------------------------------------------------------------------------

export class MockFileSystem {
  private files: Map<string, MockFile> = new Map();
  private directories: Set<string> = new Set(['/']);
  private operations: FSOperation[] = [];

  addFile(path: string, content: string | Buffer, mode = 0o644): this {
    const normalizedPath = this.normalizePath(path);

    // Ensure parent directories exist
    this.ensureDirectory(dirname(normalizedPath));

    this.files.set(normalizedPath, {
      content,
      mode,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
    });
    return this;
  }

  addDirectory(path: string, mode = 0o755): this {
    const normalizedPath = this.normalizePath(path);
    this.ensureDirectory(normalizedPath);
    return this;
  }

  existsSync(path: string): boolean {
    const normalizedPath = this.normalizePath(path);
    this.recordOperation('exists', normalizedPath);
    return this.files.has(normalizedPath) || this.directories.has(normalizedPath);
  }

  readFileSync(path: string, encoding?: BufferEncoding): string | Buffer {
    const normalizedPath = this.normalizePath(path);
    this.recordOperation('read', normalizedPath);

    const file = this.files.get(normalizedPath);
    if (!file) {
      const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
      (error as any).code = 'ENOENT';
      throw error;
    }

    if (encoding && typeof file.content === 'string') {
      return file.content;
    }
    if (encoding && Buffer.isBuffer(file.content)) {
      return file.content.toString(encoding);
    }
    return file.content;
  }

  writeFileSync(
    path: string,
    content: string | Buffer,
    options?: { mode?: number; encoding?: BufferEncoding }
  ): void {
    const normalizedPath = this.normalizePath(path);
    this.recordOperation('write', normalizedPath, { content: typeof content === 'string' ? content.slice(0, 100) : '[Buffer]' });

    // Ensure parent directory exists
    const dir = dirname(normalizedPath);
    if (!this.directories.has(dir)) {
      const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
      (error as any).code = 'ENOENT';
      throw error;
    }

    const mode = options?.mode ?? 0o644;
    const existingFile = this.files.get(normalizedPath);

    this.files.set(normalizedPath, {
      content,
      mode,
      createdAt: existingFile?.createdAt ?? Date.now(),
      modifiedAt: Date.now(),
    });
  }

  mkdirSync(path: string, options?: { recursive?: boolean; mode?: number }): void {
    const normalizedPath = this.normalizePath(path);
    this.recordOperation('mkdir', normalizedPath, options);

    if (options?.recursive) {
      this.ensureDirectory(normalizedPath);
    } else {
      const parent = dirname(normalizedPath);
      if (!this.directories.has(parent)) {
        const error = new Error(`ENOENT: no such file or directory, mkdir '${path}'`);
        (error as any).code = 'ENOENT';
        throw error;
      }
      this.directories.add(normalizedPath);
    }
  }

  rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void {
    const normalizedPath = this.normalizePath(path);
    this.recordOperation('delete', normalizedPath, options);

    if (this.files.has(normalizedPath)) {
      this.files.delete(normalizedPath);
      return;
    }

    if (this.directories.has(normalizedPath)) {
      if (options?.recursive) {
        // Remove all files and subdirectories
        for (const filePath of this.files.keys()) {
          if (filePath.startsWith(normalizedPath + '/')) {
            this.files.delete(filePath);
          }
        }
        for (const dirPath of this.directories) {
          if (dirPath.startsWith(normalizedPath + '/') || dirPath === normalizedPath) {
            this.directories.delete(dirPath);
          }
        }
        return;
      }
      // Check if directory is empty
      const hasChildren = [...this.files.keys()].some(p => p.startsWith(normalizedPath + '/')) ||
                          [...this.directories].some(d => d.startsWith(normalizedPath + '/'));
      if (hasChildren) {
        const error = new Error(`ENOTEMPTY: directory not empty, rmdir '${path}'`);
        (error as any).code = 'ENOTEMPTY';
        throw error;
      }
      this.directories.delete(normalizedPath);
      return;
    }

    if (!options?.force) {
      const error = new Error(`ENOENT: no such file or directory, unlink '${path}'`);
      (error as any).code = 'ENOENT';
      throw error;
    }
  }

  chmodSync(path: string, mode: number): void {
    const normalizedPath = this.normalizePath(path);
    this.recordOperation('chmod', normalizedPath, { mode });

    const file = this.files.get(normalizedPath);
    if (file) {
      file.mode = mode;
      return;
    }

    if (!this.directories.has(normalizedPath)) {
      const error = new Error(`ENOENT: no such file or directory, chmod '${path}'`);
      (error as any).code = 'ENOENT';
      throw error;
    }
  }

  unlinkSync(path: string): void {
    const normalizedPath = this.normalizePath(path);
    this.recordOperation('delete', normalizedPath);

    if (!this.files.has(normalizedPath)) {
      const error = new Error(`ENOENT: no such file or directory, unlink '${path}'`);
      (error as any).code = 'ENOENT';
      throw error;
    }

    this.files.delete(normalizedPath);
  }

  readdirSync(path: string): string[] {
    const normalizedPath = this.normalizePath(path);

    if (!this.directories.has(normalizedPath)) {
      const error = new Error(`ENOENT: no such file or directory, scandir '${path}'`);
      (error as any).code = 'ENOENT';
      throw error;
    }

    const entries: Set<string> = new Set();

    // Find files in this directory
    for (const filePath of this.files.keys()) {
      if (dirname(filePath) === normalizedPath) {
        entries.add(basename(filePath));
      }
    }

    // Find subdirectories
    for (const dirPath of this.directories) {
      if (dirname(dirPath) === normalizedPath && dirPath !== normalizedPath) {
        entries.add(basename(dirPath));
      }
    }

    return [...entries].sort();
  }

  getOperations(): FSOperation[] {
    return [...this.operations];
  }

  getOperationsFor(path: string): FSOperation[] {
    const normalizedPath = this.normalizePath(path);
    return this.operations.filter(op => op.path === normalizedPath);
  }

  getFileContent(path: string): string | Buffer | undefined {
    const normalizedPath = this.normalizePath(path);
    return this.files.get(normalizedPath)?.content;
  }

  getAllFiles(): Map<string, MockFile> {
    return new Map(this.files);
  }

  getAllDirectories(): Set<string> {
    return new Set(this.directories);
  }

  reset(): this {
    this.files.clear();
    this.directories.clear();
    this.directories.add('/');
    this.operations = [];
    return this;
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private normalizePath(path: string): string {
    // Handle relative paths
    if (!path.startsWith('/')) {
      path = resolvePath('/', path);
    }
    // Remove trailing slashes (except for root)
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    return path;
  }

  private ensureDirectory(path: string): void {
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current += '/' + part;
      this.directories.add(current);
    }
  }

  private recordOperation(type: FSOperation['type'], path: string, data?: unknown): void {
    this.operations.push({
      type,
      path,
      timestamp: Date.now(),
      data,
    });
  }
}

// ---------------------------------------------------------------------------
// Factory Function
// ---------------------------------------------------------------------------

export function createMockFileSystem(): MockFileSystem {
  return new MockFileSystem();
}

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

export function setupTestFileTree(fs: MockFileSystem, tree: Record<string, string | null>): void {
  for (const [path, content] of Object.entries(tree)) {
    if (content === null) {
      fs.addDirectory(path);
    } else {
      fs.addFile(path, content);
    }
  }
}
