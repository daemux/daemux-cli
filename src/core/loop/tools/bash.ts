import { spawn } from 'child_process';
import type { ToolDefinition, ToolResult } from '../../types';
import { result, resolvePath } from './helpers';

export const bashTool: ToolDefinition = {
  name: 'Bash',
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
  isConcurrencySafe: true,
};

export async function executeBash(
  toolUseId: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const command = input.command as string;
  const cwd = input.cwd as string | undefined;
  const timeout = (input.timeout as number) ?? 120000;

  if (!command) {
    return result(toolUseId, 'Error: command is required', true);
  }

  const workingDir = cwd ? resolvePath(cwd) : process.cwd();

  return new Promise<ToolResult>((resolvePromise) => {
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
        resolvePromise(result(toolUseId, `Command timed out after ${timeout}ms`, true));
        return;
      }

      const output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : '');
      const isError = code !== 0;
      const content = isError
        ? `Exit code ${code}:\n${output}`
        : output || '(no output)';

      resolvePromise(result(toolUseId, content, isError));
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise(result(toolUseId, `Error: ${err.message}`, true));
    });
  });
}
