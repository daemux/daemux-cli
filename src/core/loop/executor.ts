/**
 * Tool Executor
 * Handles parallel tool execution with error handling,
 * tool whitelisting enforcement, and concurrency safety.
 *
 * Concurrency model:
 * - Safe tools (isConcurrencySafe: true) run in parallel
 * - Unsafe tools targeting DIFFERENT files run in parallel
 * - Unsafe tools targeting the SAME file run sequentially
 */

import type { ToolResult, ToolDefinition } from '../types';
import type { ToolUseBlock, ToolCallRecord } from './types';
import type { EventBus } from '../event-bus';
import { getToolExecutor, BUILTIN_TOOLS } from './tools';
import { getLogger } from '../../infra/logger';

// ---------------------------------------------------------------------------
// Concurrency Helpers
// ---------------------------------------------------------------------------

/** Input fields that hold a target file path, keyed by tool name */
const FILE_PATH_FIELDS: Record<string, string> = {
  Write: 'path',
  Edit: 'file_path',
};

function extractFilePath(toolName: string, input: Record<string, unknown>): string | null {
  const field = FILE_PATH_FIELDS[toolName];
  if (!field) return null;
  const value = input[field];
  return typeof value === 'string' ? value : null;
}

function isToolConcurrencySafe(name: string): boolean {
  const def = BUILTIN_TOOLS.find(t => t.name === name);
  return def?.isConcurrencySafe === true;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Indexed entry used during executeAll grouping
// ---------------------------------------------------------------------------

interface IndexedEntry {
  index: number;
  toolUse: ToolUseBlock;
}

// ---------------------------------------------------------------------------
// Tool Executor Class
// ---------------------------------------------------------------------------

export class ToolExecutor {
  private eventBus: EventBus;
  private allowedTools: Set<string>;
  private customExecutors = new Map<
    string,
    (id: string, input: Record<string, unknown>) => Promise<ToolResult>
  >();

  constructor(options: { eventBus: EventBus; allowedTools?: string[] }) {
    this.eventBus = options.eventBus;
    this.allowedTools = new Set(options.allowedTools ?? BUILTIN_TOOLS.map(t => t.name));
  }

  /** Register a custom tool executor */
  registerExecutor(
    name: string,
    executor: (id: string, input: Record<string, unknown>) => Promise<ToolResult>,
  ): void {
    this.customExecutors.set(name, executor);
  }

  /** Check if a tool is allowed by the current whitelist */
  isAllowed(name: string): boolean {
    return this.allowedTools.has(name);
  }

  /**
   * Execute multiple tools with concurrency safety.
   * - Rejects disallowed tools immediately (isError: true)
   * - Safe tools run fully in parallel
   * - Unsafe tools on same file run sequentially
   * - Unsafe tools on different files run in parallel
   */
  async executeAll(toolUses: ToolUseBlock[]): Promise<ToolCallRecord[]> {
    if (toolUses.length === 0) return [];

    const results: ToolCallRecord[] = new Array(toolUses.length);

    // Phase 1: Reject disallowed tools, collect allowed ones
    const allowed: IndexedEntry[] = [];
    for (let i = 0; i < toolUses.length; i++) {
      const toolUse = toolUses[i]!;
      if (!this.isAllowed(toolUse.name)) {
        getLogger().warn(`Tool not allowed for this agent: ${toolUse.name}`, { toolUseId: toolUse.id });
        results[i] = {
          name: toolUse.name,
          input: toolUse.input,
          result: `Error: Tool '${toolUse.name}' is not allowed for this agent`,
          isError: true,
          durationMs: 0,
        };
      } else {
        allowed.push({ index: i, toolUse });
      }
    }

    if (allowed.length === 0) return results;

    // Phase 2: Group by concurrency safety
    const safe: IndexedEntry[] = [];
    const unsafeByFile = new Map<string, IndexedEntry[]>();

    for (const entry of allowed) {
      if (isToolConcurrencySafe(entry.toolUse.name)) {
        safe.push(entry);
      } else {
        const filePath = extractFilePath(entry.toolUse.name, entry.toolUse.input) ?? '__unknown__';
        const group = unsafeByFile.get(filePath);
        if (group) {
          group.push(entry);
        } else {
          unsafeByFile.set(filePath, [entry]);
        }
      }
    }

    // Phase 3: Execute -- safe in parallel, same-file unsafe in sequence
    const run = async (entry: IndexedEntry): Promise<void> => {
      results[entry.index] = await this.executeWithEvents(entry.toolUse);
    };

    const promises: Promise<void>[] = safe.map(entry => run(entry));

    for (const group of unsafeByFile.values()) {
      promises.push((async () => {
        for (const entry of group) await run(entry);
      })());
    }

    await Promise.all(promises);
    return results;
  }

  /** Execute a single tool with event emission and timing */
  private async executeWithEvents(toolUse: ToolUseBlock): Promise<ToolCallRecord> {
    const startTime = Date.now();

    await this.eventBus.emit('tool:call', {
      name: toolUse.name,
      input: toolUse.input,
      toolUseId: toolUse.id,
    });

    const result = await this.execute(toolUse);
    const durationMs = Date.now() - startTime;

    await this.eventBus.emit('tool:result', {
      toolUseId: toolUse.id,
      result: result.content,
      isError: result.isError ?? false,
    });

    return {
      name: toolUse.name,
      input: toolUse.input,
      result: result.content,
      isError: result.isError ?? false,
      durationMs,
    };
  }

  /** Execute a single tool */
  async execute(toolUse: ToolUseBlock): Promise<ToolResult> {
    const { id, name, input } = toolUse;

    if (!this.isAllowed(name)) {
      getLogger().warn(`Tool not allowed: ${name}`, { toolUseId: id });
      return { toolUseId: id, content: `Error: Tool '${name}' is not allowed for this agent`, isError: true };
    }

    const executor = this.customExecutors.get(name) ?? getToolExecutor(name);

    if (executor) {
      try {
        return await executor(id, input);
      } catch (err) {
        const msg = errorMessage(err);
        getLogger().error(`Tool execution error: ${name}`, { toolUseId: id, error: msg });
        return { toolUseId: id, content: `Error: ${msg}`, isError: true };
      }
    }

    getLogger().warn(`Tool not found: ${name}`, { toolUseId: id });
    return { toolUseId: id, content: `Error: Tool '${name}' not found`, isError: true };
  }

  /** Convert tool results to content blocks, matched by position */
  toContentBlocks(records: ToolCallRecord[], toolUses: ToolUseBlock[]): Array<{
    type: 'tool_result';
    tool_use_id: string;
    content: string;
    is_error?: boolean;
  }> {
    return toolUses.map((toolUse, i) => ({
      type: 'tool_result' as const,
      tool_use_id: toolUse.id,
      content: records[i]?.result ?? 'Error: No result',
      is_error: records[i]?.isError,
    }));
  }

  /** Get allowed tool names */
  getAllowedTools(): string[] {
    return Array.from(this.allowedTools);
  }

  /** Add an allowed tool */
  allowTool(name: string): void {
    this.allowedTools.add(name);
  }

  /** Remove an allowed tool */
  disallowTool(name: string): void {
    this.allowedTools.delete(name);
  }
}
