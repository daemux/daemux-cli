/**
 * Hook Manager - Polyglot Subprocess-Based Hook Execution
 * Executes hooks as subprocesses in any language (Python, Shell, Node, etc.)
 * Hooks receive JSON via stdin and return JSON via stdout.
 *
 * Exit code semantics:
 *   0   - Allow operation (success)
 *   1   - Show stderr to user (warning, not to Claude)
 *   2   - Block operation, show stderr to Claude (error)
 *   124 - Timeout, treated as exit 1
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Config } from './types';
import type { EventBus } from './event-bus';
import type { HookEvent, HookContext, HookResult } from './plugin-api-types';
import type { Logger } from '../infra/logger';
import { spawnAndCollect, isValidHooksFile } from './hook-executor';

interface HookEntry {
  event: HookEvent;
  command: string;
  timeout: number;
}

interface HooksFileSchema {
  hooks: Array<{
    event: HookEvent;
    command: string;
    timeout?: number;
  }>;
}

const DEFAULT_RESULT: HookResult = { allow: true };

export class HookManager {
  private config: Config;
  private eventBus: EventBus;
  private log: ReturnType<Logger['child']>;
  private hooks: Map<HookEvent, HookEntry[]> = new Map();
  private runningProcesses: Set<{ kill(): void }> = new Set();

  constructor(options: {
    config: Config;
    eventBus: EventBus;
    logger: Logger;
  }) {
    this.config = options.config;
    this.eventBus = options.eventBus;
    this.log = options.logger.child('HookManager');
  }

  /**
   * Load hooks from a hooks.json file in the given directory
   */
  loadHooks(hooksDir: string): void {
    const filePath = join(hooksDir, 'hooks.json');
    if (!existsSync(filePath)) {
      this.log.debug('No hooks.json found', { dir: hooksDir });
      return;
    }

    const parsed = this.parseHooksFile(filePath);
    if (!parsed) return;

    for (const entry of parsed.hooks) {
      this.registerHook(entry.event, entry.command, entry.timeout);
    }

    this.log.info('Hooks loaded', {
      dir: hooksDir,
      count: parsed.hooks.length,
    });
  }

  /**
   * Register a hook programmatically (for plugins)
   */
  registerHook(event: HookEvent, command: string, timeout?: number): void {
    const entry: HookEntry = {
      event,
      command,
      timeout: timeout ?? this.config.hookTimeoutMs,
    };

    const existing = this.hooks.get(event) ?? [];
    existing.push(entry);
    this.hooks.set(event, existing);

    this.log.debug('Hook registered', { event, command, timeout: entry.timeout });
  }

  /**
   * Execute a single hook command as a subprocess.
   * NEVER throws -- always returns a HookResult (fail-open).
   */
  async executeHook(event: HookEvent, context: HookContext): Promise<HookResult> {
    const results = await this.executeHooks(event, context);
    return results[0] ?? { ...DEFAULT_RESULT };
  }

  /**
   * Execute all hooks registered for a given event sequentially.
   * If any hook returns deny (exit 2), execution stops immediately.
   */
  async executeHooks(event: HookEvent, context: HookContext): Promise<HookResult[]> {
    const entries = this.hooks.get(event);
    if (!entries || entries.length === 0) {
      return [];
    }

    const results: HookResult[] = [];

    for (const entry of entries) {
      await this.emitHookEvent('hook:invoke', event, context);
      const result = await this.executeHookEntry(entry, context);
      await this.emitHookEvent('hook:result', event, context, result);
      results.push(result);

      if (!result.allow) {
        break;
      }
    }

    return results;
  }

  /**
   * Kill all running hook subprocesses
   */
  shutdown(): void {
    for (const proc of this.runningProcesses) {
      try {
        proc.kill();
      } catch {
        // Process may have already exited
      }
    }
    this.runningProcesses.clear();
    const hookCount = Array.from(this.hooks.values()).reduce((sum, e) => sum + e.length, 0);
    this.log.info('Hook manager shut down', { hookCount });
  }

  private parseHooksFile(filePath: string): HooksFileSchema | null {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as unknown;
      if (!isValidHooksFile(data)) {
        this.log.warn('Invalid hooks.json format', { filePath });
        return null;
      }
      return data as HooksFileSchema;
    } catch (err) {
      this.log.error('Failed to parse hooks.json', {
        filePath,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  private async executeHookEntry(
    entry: HookEntry,
    context: HookContext
  ): Promise<HookResult> {
    const parts = entry.command.split(/\s+/);
    const cmd = parts[0];
    if (!cmd) {
      this.log.warn('Empty hook command', { event: entry.event });
      return { ...DEFAULT_RESULT };
    }
    const cmdArgs = parts.slice(1);

    try {
      return await spawnAndCollect(
        cmd, cmdArgs, context, entry.timeout, this.runningProcesses, this.log,
      );
    } catch (err) {
      this.log.error('Hook execution failed', {
        command: entry.command,
        event: entry.event,
        error: err instanceof Error ? err.message : String(err),
      });
      return { ...DEFAULT_RESULT };
    }
  }

  private async emitHookEvent(
    busEvent: 'hook:invoke' | 'hook:result',
    event: HookEvent,
    context: HookContext,
    result?: HookResult,
  ): Promise<void> {
    try {
      if (busEvent === 'hook:invoke') {
        await this.eventBus.emit('hook:invoke', {
          event, sessionId: context.sessionId, data: context.data,
        });
      } else {
        await this.eventBus.emit('hook:result', {
          event, sessionId: context.sessionId,
          allow: result?.allow ?? true, error: result?.error,
        });
      }
    } catch {
      // Event emission must never block hook execution
    }
  }
}

let globalHookManager: HookManager | null = null;

export function createHookManager(options: {
  config: Config;
  eventBus: EventBus;
  logger: Logger;
}): HookManager {
  globalHookManager = new HookManager(options);
  return globalHookManager;
}

export function getHookManager(): HookManager {
  if (!globalHookManager) {
    throw new Error('Hook manager not initialized. Call createHookManager first.');
  }
  return globalHookManager;
}
