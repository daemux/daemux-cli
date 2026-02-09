/**
 * SpawnAgent Built-in Tool
 * Spawns a subagent to execute a task, blocks until completion.
 * Uses dependency injection (closure) to avoid circular imports.
 */

import type { ToolDefinition, ToolResult, AgentDefinition, SubagentRecord } from '../../types';
import { result } from './helpers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpawnAgentDeps {
  spawnSubagent: (
    agentName: string,
    task: string,
    options?: { timeout?: number; tools?: string[]; parentId?: string; depth?: number },
  ) => Promise<SubagentRecord>;
  listAgents: () => AgentDefinition[];
  getAgent: (name: string) => AgentDefinition | undefined;
  /** Current nesting depth of the calling agent */
  currentDepth?: number;
  /** Parent subagent record ID for lineage tracking */
  parentId?: string;
}

export interface SpawnAgentInput {
  agent_name?: string;
  task: string;
  timeout?: number;
  tools?: string[];
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const spawnAgentTool: ToolDefinition = {
  name: 'SpawnAgent',
  description:
    'Spawn a subagent to execute a task. ' +
    'If agent_name is provided, uses that registered agent configuration. ' +
    'Otherwise uses a general-purpose agent with all tools. ' +
    'Blocks until the subagent completes and returns its result.',
  inputSchema: {
    type: 'object',
    properties: {
      agent_name: {
        type: 'string',
        description: 'Name of a registered agent to use. If omitted, uses general config.',
      },
      task: {
        type: 'string',
        description: 'The task description for the subagent to execute.',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 300000 = 5 minutes).',
      },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of tool names to restrict the subagent to.',
      },
    },
    required: ['task'],
  },
  isConcurrencySafe: true,
};

// ---------------------------------------------------------------------------
// Factory: Creates the tool executor with injected dependencies
// ---------------------------------------------------------------------------

/**
 * Create a SpawnAgent tool executor bound to the given dependencies.
 * Call this at startup time when AgentRegistry and LLMProvider are available.
 *
 * Returns the tool definition and a bound executor function.
 */
export function createSpawnAgentTool(deps: SpawnAgentDeps): {
  definition: ToolDefinition;
  execute: (toolUseId: string, input: Record<string, unknown>) => Promise<ToolResult>;
} {
  const execute = async (
    toolUseId: string,
    input: Record<string, unknown>,
  ): Promise<ToolResult> => {
    const agentName = input.agent_name as string | undefined;
    const task = input.task as string | undefined;
    const timeout = input.timeout as number | undefined;
    const tools = input.tools as string[] | undefined;

    if (!task || typeof task !== 'string' || task.trim().length === 0) {
      return result(toolUseId, 'Error: task is required and must be a non-empty string', true);
    }

    return executeSpawnAgent(toolUseId, { agent_name: agentName, task, timeout, tools }, deps);
  };

  return { definition: spawnAgentTool, execute };
}

// ---------------------------------------------------------------------------
// Core execution logic
// ---------------------------------------------------------------------------

async function executeSpawnAgent(
  toolUseId: string,
  input: SpawnAgentInput,
  deps: SpawnAgentDeps,
): Promise<ToolResult> {
  const { agent_name: agentName, task, timeout, tools } = input;

  try {
    const resolvedName = resolveAgentName(agentName, deps);

    const record = await deps.spawnSubagent(resolvedName, task, {
      timeout,
      tools,
      parentId: deps.parentId,
      depth: (deps.currentDepth ?? 0) + 1,
    });

    return formatResult(toolUseId, record, resolvedName);
  } catch (err) {
    return handleSpawnError(toolUseId, err);
  }
}

/** Resolve the agent name, falling back to 'general' or the first available agent. */
function resolveAgentName(agentName: string | undefined, deps: SpawnAgentDeps): string {
  if (!agentName) {
    if (deps.getAgent('general')) {
      return 'general';
    }
    const agents = deps.listAgents();
    if (agents.length > 0) {
      return agents[0]!.name;
    }
    throw new Error('No agents registered. Cannot spawn a subagent.');
  }

  const agent = deps.getAgent(agentName);
  if (!agent) {
    const available = deps.listAgents().map(a => a.name);
    throw new Error(
      `Agent '${agentName}' not found. ` +
      `Available agents: ${available.length > 0 ? available.join(', ') : 'none'}`
    );
  }

  return agentName;
}

/** Format the subagent record into a ToolResult for the parent agent. */
function formatResult(
  toolUseId: string,
  record: SubagentRecord,
  agentName: string,
): ToolResult {
  if (record.status === 'completed') {
    const output = record.result || 'Subagent completed with no output.';
    return result(toolUseId, `[${agentName}] ${output}`);
  }

  if (record.status === 'timeout') {
    return result(
      toolUseId,
      `Error: Subagent '${agentName}' timed out after ${record.timeoutMs}ms`,
      true,
    );
  }

  if (record.status === 'failed') {
    return result(
      toolUseId,
      `Error: Subagent '${agentName}' failed: ${record.result ?? 'Unknown error'}`,
      true,
    );
  }

  // Unexpected: still running (sync execution should complete before returning)
  return result(
    toolUseId,
    `Subagent '${agentName}' spawned (id: ${record.id}, status: ${record.status})`,
  );
}

/** Handle errors during spawn and return a structured error result. */
function handleSpawnError(toolUseId: string, err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return result(toolUseId, `Error: ${message}`, true);
}
