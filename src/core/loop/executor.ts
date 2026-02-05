/**
 * Tool Executor
 * Handles parallel tool execution with error handling
 */

import type { ToolResult } from '../types';
import type { ToolUseBlock, ToolCallRecord } from './types';
import type { EventBus } from '../event-bus';
import { getToolExecutor, BUILTIN_TOOLS } from './tools';
import { getLogger } from '../../infra/logger';

// ---------------------------------------------------------------------------
// Tool Executor Class
// ---------------------------------------------------------------------------

export class ToolExecutor {
  private eventBus: EventBus;
  private allowedTools: Set<string>;
  private customExecutors: Map<string, (id: string, input: Record<string, unknown>) => Promise<ToolResult>>;

  constructor(options: {
    eventBus: EventBus;
    allowedTools?: string[];
  }) {
    this.eventBus = options.eventBus;
    this.allowedTools = new Set(options.allowedTools ?? BUILTIN_TOOLS.map(t => t.name));
    this.customExecutors = new Map();
  }

  /**
   * Register a custom tool executor
   */
  registerExecutor(
    name: string,
    executor: (id: string, input: Record<string, unknown>) => Promise<ToolResult>
  ): void {
    this.customExecutors.set(name, executor);
  }

  /**
   * Check if a tool is allowed
   */
  isAllowed(name: string): boolean {
    return this.allowedTools.has(name);
  }

  /**
   * Execute multiple tools in parallel
   */
  async executeAll(toolUses: ToolUseBlock[]): Promise<ToolCallRecord[]> {
    const results = await Promise.all(
      toolUses.map(async (toolUse) => {
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
      })
    );

    return results;
  }

  /**
   * Execute a single tool
   */
  async execute(toolUse: ToolUseBlock): Promise<ToolResult> {
    const { id, name, input } = toolUse;

    // Check if tool is allowed
    if (!this.isAllowed(name)) {
      getLogger().warn(`Tool not allowed: ${name}`, { toolUseId: id });
      return {
        toolUseId: id,
        content: `Error: Tool '${name}' is not allowed`,
        isError: true,
      };
    }

    // Try custom executor first
    const customExecutor = this.customExecutors.get(name);
    if (customExecutor) {
      try {
        return await customExecutor(id, input);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        getLogger().error(`Tool execution error: ${name}`, { toolUseId: id, error: msg });
        return {
          toolUseId: id,
          content: `Error: ${msg}`,
          isError: true,
        };
      }
    }

    // Try built-in executor
    const builtinExecutor = getToolExecutor(name);
    if (builtinExecutor) {
      try {
        return await builtinExecutor(id, input);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        getLogger().error(`Tool execution error: ${name}`, { toolUseId: id, error: msg });
        return {
          toolUseId: id,
          content: `Error: ${msg}`,
          isError: true,
        };
      }
    }

    // Tool not found
    getLogger().warn(`Tool not found: ${name}`, { toolUseId: id });
    return {
      toolUseId: id,
      content: `Error: Tool '${name}' not found`,
      isError: true,
    };
  }

  /**
   * Convert tool results to content blocks
   */
  toContentBlocks(records: ToolCallRecord[], toolUses: ToolUseBlock[]): Array<{
    type: 'tool_result';
    tool_use_id: string;
    content: string;
    is_error?: boolean;
  }> {
    return toolUses.map((toolUse) => {
      const record = records.find(r => r.name === toolUse.name);
      return {
        type: 'tool_result' as const,
        tool_use_id: toolUse.id,
        content: record?.result ?? 'Error: No result',
        is_error: record?.isError,
      };
    });
  }

  /**
   * Get allowed tool names
   */
  getAllowedTools(): string[] {
    return Array.from(this.allowedTools);
  }

  /**
   * Add an allowed tool
   */
  allowTool(name: string): void {
    this.allowedTools.add(name);
  }

  /**
   * Remove an allowed tool
   */
  disallowTool(name: string): void {
    this.allowedTools.delete(name);
  }
}
