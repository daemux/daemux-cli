/**
 * Built-in Tools for the Agentic Loop
 * Provides basic file and command execution capabilities
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve, isAbsolute } from 'path';
import { spawn } from 'child_process';
import type { ToolDefinition, ToolResult } from '../types';

// ---------------------------------------------------------------------------
// Tool Result Helper
// ---------------------------------------------------------------------------

function result(toolUseId: string, content: string, isError = false): ToolResult {
  return { toolUseId, content, isError };
}

// ---------------------------------------------------------------------------
// Read File Tool
// ---------------------------------------------------------------------------

export const readFileTool: ToolDefinition = {
  name: 'Read',  // Must match Claude Code tool name for OAuth token auth
  description: 'Read the contents of a file at the specified path',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path to the file to read',
      },
      encoding: {
        type: 'string',
        description: 'The encoding to use (default: utf-8)',
      },
    },
    required: ['path'],
  },
};

export async function executeReadFile(
  toolUseId: string,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const path = input.path as string;
  const encoding = (input.encoding as BufferEncoding) ?? 'utf-8';

  if (!path) {
    return result(toolUseId, 'Error: path is required', true);
  }

  const resolvedPath = isAbsolute(path) ? path : resolve(process.cwd(), path);

  if (!existsSync(resolvedPath)) {
    return result(toolUseId, `Error: File not found: ${resolvedPath}`, true);
  }

  try {
    const content = readFileSync(resolvedPath, encoding);
    return result(toolUseId, content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return result(toolUseId, `Error reading file: ${msg}`, true);
  }
}

// ---------------------------------------------------------------------------
// Write File Tool
// ---------------------------------------------------------------------------

export const writeFileTool: ToolDefinition = {
  name: 'Write',  // Must match Claude Code tool name for OAuth token auth
  description: 'Write content to a file at the specified path',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'The path to the file to write',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file',
      },
      encoding: {
        type: 'string',
        description: 'The encoding to use (default: utf-8)',
      },
    },
    required: ['path', 'content'],
  },
};

export async function executeWriteFile(
  toolUseId: string,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const path = input.path as string;
  const content = input.content as string;
  const encoding = (input.encoding as BufferEncoding) ?? 'utf-8';

  if (!path) {
    return result(toolUseId, 'Error: path is required', true);
  }
  if (content === undefined) {
    return result(toolUseId, 'Error: content is required', true);
  }

  const resolvedPath = isAbsolute(path) ? path : resolve(process.cwd(), path);

  try {
    // Create directory if needed
    const dir = dirname(resolvedPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(resolvedPath, content, encoding);
    return result(toolUseId, `File written successfully: ${resolvedPath}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return result(toolUseId, `Error writing file: ${msg}`, true);
  }
}

// ---------------------------------------------------------------------------
// Bash Tool
// ---------------------------------------------------------------------------

export const bashTool: ToolDefinition = {
  name: 'Bash',  // Must match Claude Code tool name for OAuth token auth
  description: 'Execute a bash command and return the output',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The bash command to execute',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for the command',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 120000)',
      },
    },
    required: ['command'],
  },
};

export async function executeBash(
  toolUseId: string,
  input: Record<string, unknown>
): Promise<ToolResult> {
  const command = input.command as string;
  const cwd = input.cwd as string | undefined;
  const timeout = (input.timeout as number) ?? 120000;

  if (!command) {
    return result(toolUseId, 'Error: command is required', true);
  }

  const workingDir = cwd
    ? isAbsolute(cwd)
      ? cwd
      : resolve(process.cwd(), cwd)
    : process.cwd();

  return new Promise<ToolResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const proc = spawn('bash', ['-c', command], {
      cwd: workingDir,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 5000);
    }, timeout);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timer);

      if (killed) {
        resolve(result(toolUseId, `Command timed out after ${timeout}ms`, true));
        return;
      }

      const output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : '');
      const isError = code !== 0;
      const content = isError
        ? `Exit code ${code}:\n${output}`
        : output || '(no output)';

      resolve(result(toolUseId, content, isError));
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve(result(toolUseId, `Error: ${err.message}`, true));
    });
  });
}

// ---------------------------------------------------------------------------
// Tool Registry
// ---------------------------------------------------------------------------

export const BUILTIN_TOOLS: ToolDefinition[] = [
  readFileTool,
  writeFileTool,
  bashTool,
];

type ToolExecutor = (
  toolUseId: string,
  input: Record<string, unknown>
) => Promise<ToolResult>;

const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  Read: executeReadFile,
  Write: executeWriteFile,
  Bash: executeBash,
};

export function getToolExecutor(name: string): ToolExecutor | undefined {
  return TOOL_EXECUTORS[name];
}

export function registerToolExecutor(name: string, executor: ToolExecutor): void {
  TOOL_EXECUTORS[name] = executor;
}
