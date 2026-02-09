/** SpawnAgent Tool - spawns a subagent to execute a task, blocks until completion. */

import type { ToolDefinition, ToolResult, AgentDefinition, SubagentRecord } from '../../types';
import { result } from './helpers';

export interface SpawnAgentDeps {
  spawnSubagent: (
    agentName: string,
    task: string,
    options?: {
      timeout?: number; tools?: string[]; parentId?: string;
      depth?: number; resumeSessionId?: string;
    },
  ) => Promise<SubagentRecord>;
  listAgents: () => AgentDefinition[];
  getAgent: (name: string) => AgentDefinition | undefined;
  currentDepth?: number;
  parentId?: string;
  getSubagentSessionId?: (recordId: string) => string | undefined;
}

export interface SpawnAgentInput {
  agent_name?: string;
  task: string;
  timeout?: number;
  tools?: string[];
  resume?: string;
}

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
      resume: {
        type: 'string',
        description: 'Resume a previous subagent session by its record ID.',
      },
    },
    required: ['task'],
  },
  isConcurrencySafe: true,
};

/** Create a SpawnAgent executor bound to the given dependencies. */
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
    const resume = input.resume as string | undefined;

    if (!task || typeof task !== 'string' || task.trim().length === 0) {
      return result(toolUseId, 'Error: task is required and must be a non-empty string', true);
    }

    return executeSpawnAgent(toolUseId, { agent_name: agentName, task, timeout, tools, resume }, deps);
  };

  return { definition: spawnAgentTool, execute };
}

async function executeSpawnAgent(
  toolUseId: string,
  input: SpawnAgentInput,
  deps: SpawnAgentDeps,
): Promise<ToolResult> {
  const { agent_name: agentName, task, timeout, tools, resume } = input;

  try {
    // Resolve resume record ID to a loop session ID
    let resumeSessionId: string | undefined;
    if (resume) {
      if (!deps.getSubagentSessionId) {
        return result(toolUseId, 'Error: Resume is not supported (no session resolver configured)', true);
      }
      resumeSessionId = deps.getSubagentSessionId(resume);
      if (!resumeSessionId) {
        return result(
          toolUseId,
          `Error: No session found for subagent record '${resume}'. ` +
          'The subagent may not have completed a previous run.',
          true,
        );
      }
    }

    const resolvedName = resolveAgentName(agentName, deps);

    const record = await deps.spawnSubagent(resolvedName, task, {
      timeout,
      tools,
      parentId: deps.parentId,
      depth: (deps.currentDepth ?? 0) + 1,
      resumeSessionId,
    });

    return formatResult(toolUseId, record, resolvedName);
  } catch (err) {
    return handleSpawnError(toolUseId, err);
  }
}

/** Resolve agent name, falling back to 'general' or the first available agent. */
function resolveAgentName(agentName: string | undefined, deps: SpawnAgentDeps): string {
  if (!agentName) {
    if (deps.getAgent('general')) return 'general';
    const agents = deps.listAgents();
    if (agents.length > 0) return agents[0]!.name;
    throw new Error('No agents registered. Cannot spawn a subagent.');
  }
  if (!deps.getAgent(agentName)) {
    const available = deps.listAgents().map(a => a.name);
    throw new Error(
      `Agent '${agentName}' not found. Available agents: ${available.length > 0 ? available.join(', ') : 'none'}`
    );
  }
  return agentName;
}

function formatResult(toolUseId: string, record: SubagentRecord, agentName: string): ToolResult {
  if (record.status === 'completed') {
    return result(toolUseId, `[${agentName}] ${record.result || 'Subagent completed with no output.'}`);
  }
  if (record.status === 'timeout') {
    return result(toolUseId, `Error: Subagent '${agentName}' timed out after ${record.timeoutMs}ms`, true);
  }
  if (record.status === 'failed') {
    return result(toolUseId, `Error: Subagent '${agentName}' failed: ${record.result ?? 'Unknown error'}`, true);
  }
  return result(toolUseId, `Subagent '${agentName}' spawned (id: ${record.id}, status: ${record.status})`);
}

function handleSpawnError(toolUseId: string, err: unknown): ToolResult {
  return result(toolUseId, `Error: ${err instanceof Error ? err.message : String(err)}`, true);
}
