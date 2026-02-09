/**
 * MCP Tool Bridge
 * Creates ToolExecutor-compatible executors from MCPServerManager,
 * bridging MCP tools into the agentic loop's tool system.
 */

import type { ToolDefinition, ToolResult } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MCPServerManagerLike {
  getToolDefinitions(): ToolDefinition[];
  callTool(qualifiedName: string, input: unknown): Promise<unknown>;
}

type ToolExecutorFn = (
  toolUseId: string,
  input: Record<string, unknown>
) => Promise<ToolResult>;

export interface MCPToolBridge {
  tools: ToolDefinition[];
  executors: Map<string, ToolExecutorFn>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build ToolDefinition[] and a Map of executor functions from an
 * MCPServerManager so they can be registered on the agentic loop's
 * ToolExecutor.
 */
export function createMCPToolBridge(manager: MCPServerManagerLike): MCPToolBridge {
  const tools = manager.getToolDefinitions();
  const executors = new Map<string, ToolExecutorFn>();

  for (const tool of tools) {
    executors.set(tool.name, createExecutor(manager, tool.name));
  }

  return { tools, executors };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createExecutor(manager: MCPServerManagerLike, toolName: string): ToolExecutorFn {
  return async (toolUseId, input) => {
    try {
      const raw = await manager.callTool(toolName, input);
      return { toolUseId, content: formatResult(raw) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        toolUseId,
        content: JSON.stringify({
          isError: true,
          content: [{ type: 'text', text: message }],
        }),
        isError: true,
      };
    }
  };
}

function formatResult(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw == null) return '';
  return JSON.stringify(raw);
}
