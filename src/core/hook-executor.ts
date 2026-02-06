/**
 * Hook Executor - Subprocess Execution for Hooks
 * Handles spawning hook subprocesses, collecting output, and interpreting exit codes.
 */

import type { HookResult, HookContext } from './plugin-api-types';
import type { Logger } from '../infra/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXIT_CODE_ALLOW = 0;
const EXIT_CODE_WARN = 1;
const EXIT_CODE_DENY = 2;
const EXIT_CODE_TIMEOUT = 124;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Spawn a hook command as a subprocess, pipe context as JSON to stdin,
 * and collect stdout/stderr. Returns a HookResult based on the exit code.
 */
export async function spawnAndCollect(
  cmd: string,
  args: string[],
  context: HookContext,
  timeoutMs: number,
  runningProcesses: Set<{ kill(): void }>,
  log: ReturnType<Logger['child']>,
): Promise<HookResult> {
  const proc = Bun.spawn([cmd, ...args], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  runningProcesses.add(proc);

  try {
    const stdin = proc.stdin as import('bun').FileSink;
    stdin.write(JSON.stringify(context));
    stdin.end();

    const stdoutPromise = new Response(proc.stdout as ReadableStream<Uint8Array>).text();
    const stderrPromise = new Response(proc.stderr as ReadableStream<Uint8Array>).text();

    const raceResult = await Promise.race([
      proc.exited.then((code: number) => ({ type: 'exit' as const, code })),
      createTimeout(timeoutMs).then(() => ({ type: 'timeout' as const, code: EXIT_CODE_TIMEOUT })),
    ]);

    if (raceResult.type === 'timeout') {
      proc.kill();
      return buildWarnResult('Hook timed out');
    }

    const [stdoutText, stderrText] = await Promise.all([stdoutPromise, stderrPromise]);
    return interpretExitCode(raceResult.code, stdoutText, stderrText, log);
  } finally {
    runningProcesses.delete(proc);
  }
}

/**
 * Map an exit code to a HookResult using stdout/stderr content.
 */
export function interpretExitCode(
  exitCode: number,
  stdout: string,
  stderr: string,
  log: ReturnType<Logger['child']>,
): HookResult {
  switch (exitCode) {
    case EXIT_CODE_ALLOW:
      return parseStdoutResult(stdout, log);
    case EXIT_CODE_WARN:
      return buildWarnResult(stderr.trim() || 'Hook returned warning');
    case EXIT_CODE_DENY:
      return buildDenyResult(stderr.trim() || 'Hook blocked operation');
    case EXIT_CODE_TIMEOUT:
      return buildWarnResult('Hook timed out');
    default:
      return buildWarnResult(`Hook exited with code ${exitCode}`);
  }
}

/**
 * Parse JSON stdout from a hook process into a HookResult.
 * Falls back to allow if stdout is empty or not valid JSON.
 */
export function parseStdoutResult(
  stdout: string,
  log: ReturnType<Logger['child']>,
): HookResult {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { allow: true };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === 'object' && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      return {
        allow: obj.allow !== false,
        additionalContext: typeof obj.additionalContext === 'string'
          ? obj.additionalContext
          : undefined,
        error: typeof obj.error === 'string' ? obj.error : undefined,
      };
    }
  } catch {
    log.debug('Hook stdout was not valid JSON, treating as allow', {
      stdout: trimmed.slice(0, 200),
    });
  }

  return { allow: true };
}

export function buildWarnResult(message: string): HookResult {
  return { allow: true, error: message };
}

export function buildDenyResult(message: string): HookResult {
  return { allow: false, error: message };
}

export function createTimeout(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Validate that parsed JSON matches the HooksFileSchema shape.
 * Uses generic T so the caller's type-guard narrows to their specific schema.
 */
export function isValidHooksFile<T = unknown>(
  data: unknown
): data is T {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.hooks)) return false;

  for (const hook of obj.hooks) {
    if (typeof hook !== 'object' || hook === null) return false;
    const h = hook as Record<string, unknown>;
    if (typeof h.event !== 'string') return false;
    if (typeof h.command !== 'string') return false;
    if (h.timeout !== undefined && typeof h.timeout !== 'number') return false;
  }
  return true;
}
