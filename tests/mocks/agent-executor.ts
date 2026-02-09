/**
 * Mock Agent Executor
 * Simulates tool execution with predefined outputs per tool name.
 * Tracks all execution calls for assertion.
 */

import type { ToolResult } from '../../src/core/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutorCall {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  timestamp: number;
}

export interface MockAgentExecutor {
  execute: (toolUseId: string, toolName: string, input: Record<string, unknown>) => Promise<ToolResult>;
  calls: ExecutorCall[];
  getCallCount: () => number;
  getCallsByTool: (toolName: string) => ExecutorCall[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMockAgentExecutor(
  outputs?: Map<string, string>,
): MockAgentExecutor {
  const defaultOutputs = outputs ?? new Map<string, string>();
  const calls: ExecutorCall[] = [];

  return {
    calls,
    getCallCount: () => calls.length,
    getCallsByTool: (toolName: string) => calls.filter(c => c.toolName === toolName),

    execute: async (
      toolUseId: string,
      toolName: string,
      input: Record<string, unknown>,
    ): Promise<ToolResult> => {
      calls.push({ toolUseId, toolName, input, timestamp: Date.now() });

      const output = defaultOutputs.get(toolName);
      if (output !== undefined) {
        return { toolUseId, content: output };
      }

      return { toolUseId, content: `Mock output for ${toolName}` };
    },
  };
}
