/**
 * Mock Agent Registry
 * Reusable mock for AgentRegistry with predefined agents, spawn tracking,
 * and configurable spawn behavior (delay, failure, timeout).
 */

import type { AgentDefinition, SubagentRecord } from '../../src/core/types';
import type { AgentRegistry, SpawnSubagentOptions } from '../../src/core/agent-registry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MockRegistryOptions {
  agents?: AgentDefinition[];
  spawnResult?: SubagentRecord;
  spawnDelay?: number;
  spawnError?: string;
}

export interface SpawnCall {
  agentName: string;
  task: string;
  options?: SpawnSubagentOptions;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function makeAgentDef(name: string, overrides?: Partial<AgentDefinition>): AgentDefinition {
  return {
    name,
    description: `Agent ${name}`,
    model: 'inherit',
    tools: ['Read', 'Write', 'Bash'],
    color: 'blue',
    systemPrompt: `You are ${name}.`,
    pluginId: 'core',
    ...overrides,
  };
}

export function makeSubagentRecord(overrides?: Partial<SubagentRecord>): SubagentRecord {
  return {
    id: `rec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    agentName: 'general',
    parentId: null,
    taskDescription: 'task',
    status: 'completed',
    spawnedAt: Date.now(),
    timeoutMs: 300000,
    result: 'Done',
    tokensUsed: 100,
    toolUses: 2,
    completedAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock Registry Factory
// ---------------------------------------------------------------------------

export function createMockAgentRegistry(options?: MockRegistryOptions): AgentRegistry & {
  spawnCalls: SpawnCall[];
  getSpawnCount: () => number;
} {
  const agents = options?.agents ?? [makeAgentDef('general')];
  const spawnResult = options?.spawnResult ?? makeSubagentRecord();
  const spawnDelay = options?.spawnDelay ?? 0;
  const spawnError = options?.spawnError;

  const agentMap = new Map(agents.map(a => [a.name, a]));
  const spawnCalls: SpawnCall[] = [];

  const registry = {
    spawnCalls,
    getSpawnCount: () => spawnCalls.length,

    getAgent: (name: string) => agentMap.get(name),
    hasAgent: (name: string) => agentMap.has(name),
    listAgents: () => Array.from(agentMap.values()),
    registerAgent: (agent: AgentDefinition) => { agentMap.set(agent.name, agent); },
    loadAgents: (agentList: AgentDefinition[]) => {
      for (const a of agentList) agentMap.set(a.name, a);
    },

    spawnSubagent: async (
      agentName: string,
      task: string,
      spawnOpts?: SpawnSubagentOptions,
    ): Promise<SubagentRecord> => {
      spawnCalls.push({ agentName, task, options: spawnOpts, timestamp: Date.now() });

      if (spawnDelay > 0) {
        await new Promise(r => setTimeout(r, spawnDelay));
      }

      if (spawnError) {
        throw new Error(spawnError);
      }

      return makeSubagentRecord({ ...spawnResult, agentName });
    },

    resolveModel: () => 'claude-sonnet-4-20250514',
    getAgentTools: (agent: AgentDefinition, available: string[]) => {
      if (!agent.tools || agent.tools.length === 0) return available;
      return agent.tools.filter(t => available.includes(t));
    },

    setProvider: () => {},
    setLoopFactory: () => {},
    getSubagentSessionId: () => undefined,
    clearSessions: () => {},
    getRunningSubagents: () => [],
    checkTimeouts: async () => 0,
    markOrphaned: async () => 0,
    completeSubagent: async () => spawnResult,
    failSubagent: async () => spawnResult,
    timeoutSubagent: async () => spawnResult,
  } as unknown as AgentRegistry & {
    spawnCalls: SpawnCall[];
    getSpawnCount: () => number;
  };

  return registry;
}
