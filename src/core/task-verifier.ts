/**
 * Task Verifier - Runs verification commands on completed tasks.
 * When a task completes and has a verifyCommand, spawns a shell subprocess.
 * Exit code 0 = passed. Non-zero = failed and may be retried up to maxRetries.
 */

import type { EventBus } from './event-bus';
import type { TaskManager } from './task-manager';
import type { Task } from './types';
import { getLogger } from '../infra/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_VERIFY_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_LENGTH = 2000;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface TaskVerifierOptions {
  eventBus: EventBus;
  taskManager: TaskManager;
  maxRetries?: number;
  verifyTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Verification Result
// ---------------------------------------------------------------------------

export interface VerifyResult {
  exitCode: number;
  output: string;
}

// ---------------------------------------------------------------------------
// Task Verifier Class
// ---------------------------------------------------------------------------

export class TaskVerifier {
  private unsubscribe: (() => void) | null = null;
  private readonly eventBus: EventBus;
  private readonly taskManager: TaskManager;
  private readonly maxRetries: number;
  private readonly verifyTimeoutMs: number;

  constructor(options: TaskVerifierOptions) {
    this.eventBus = options.eventBus;
    this.taskManager = options.taskManager;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.verifyTimeoutMs = options.verifyTimeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
  }

  /**
   * Subscribe to task:completed events and start verifying tasks.
   */
  start(): void {
    if (this.unsubscribe) return;

    this.unsubscribe = this.eventBus.on('task:completed', ({ task }) => {
      this.handleCompletion(task).catch(err => {
        getLogger().error('TaskVerifier: unhandled error in handleCompletion', {
          taskId: task.id,
          error: String(err),
        });
      });
    });

    getLogger().debug('TaskVerifier: started');
  }

  /**
   * Unsubscribe from events and stop verifying.
   */
  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
      getLogger().debug('TaskVerifier: stopped');
    }
  }

  /**
   * Handle a task completion by running its verify command (if present).
   */
  async handleCompletion(task: Task): Promise<void> {
    if (!task.verifyCommand) return;

    const log = getLogger();
    log.info('TaskVerifier: running verification', {
      taskId: task.id,
      subject: task.subject,
      command: task.verifyCommand,
    });

    const result = await this.runVerification(task.verifyCommand);

    if (result.exitCode === 0) {
      await this.taskManager.update(task.id, {
        metadata: { ...task.metadata, verifyPassed: true },
      });

      await this.eventBus.emit('task:verification_passed', {
        taskId: task.id,
        subject: task.subject,
      });

      log.info('TaskVerifier: verification passed', { taskId: task.id });
      return;
    }

    // Verification failed
    const currentRetryCount = task.retryCount ?? 0;

    log.warn('TaskVerifier: verification failed', {
      taskId: task.id,
      exitCode: result.exitCode,
      retryCount: currentRetryCount,
      maxRetries: this.maxRetries,
    });

    await this.taskManager.fail(task.id, `Verification failed (exit ${result.exitCode}): ${result.output}`);

    await this.eventBus.emit('task:verification_failed', {
      taskId: task.id,
      subject: task.subject,
      attempt: currentRetryCount + 1,
      output: result.output,
    });

    if (currentRetryCount < this.maxRetries) {
      await this.taskManager.retry(task.id);
      log.info('TaskVerifier: task retried after verification failure', { taskId: task.id });
    } else {
      log.warn('TaskVerifier: max retries exhausted, task stays failed', { taskId: task.id });
    }
  }

  /**
   * Spawn a shell subprocess to run the verification command.
   * Captures stdout + stderr combined, truncated to MAX_OUTPUT_LENGTH.
   * Handles timeout by killing the process and returning a non-zero exit code.
   */
  async runVerification(command: string): Promise<VerifyResult> {
    const proc = Bun.spawn(['sh', '-c', command], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stdoutPromise = new Response(proc.stdout as ReadableStream<Uint8Array>).text();
    const stderrPromise = new Response(proc.stderr as ReadableStream<Uint8Array>).text();

    let timeoutId: ReturnType<typeof setTimeout>;
    const raceResult = await Promise.race([
      proc.exited.then((code: number) => {
        clearTimeout(timeoutId);
        return { type: 'exit' as const, code };
      }),
      new Promise<{ type: 'timeout'; code: number }>(resolve => {
        timeoutId = setTimeout(() => resolve({ type: 'timeout', code: 124 }), this.verifyTimeoutMs);
      }),
    ]);

    if (raceResult.type === 'timeout') {
      proc.kill();
      await Promise.allSettled([stdoutPromise, stderrPromise]);
      return { exitCode: 124, output: `Command timed out after ${this.verifyTimeoutMs}ms` };
    }

    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    const combined = [stdout, stderr].filter(Boolean).join('\n').trim();

    return {
      exitCode: raceResult.code,
      output: combined.slice(0, MAX_OUTPUT_LENGTH),
    };
  }
}

// ---------------------------------------------------------------------------
// Global Instance
// ---------------------------------------------------------------------------

let globalTaskVerifier: TaskVerifier | null = null;

export function createTaskVerifier(options: TaskVerifierOptions): TaskVerifier {
  globalTaskVerifier = new TaskVerifier(options);
  return globalTaskVerifier;
}

export function getTaskVerifier(): TaskVerifier {
  if (!globalTaskVerifier) {
    throw new Error('TaskVerifier not initialized. Call createTaskVerifier first.');
  }
  return globalTaskVerifier;
}
