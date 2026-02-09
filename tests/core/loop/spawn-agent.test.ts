/**
 * SpawnAgent Tool Tests - Core
 * Tests the SpawnAgent built-in tool definition, factory, and basic execution.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  spawnAgentTool,
  createSpawnAgentTool,
} from '../../../src/core/loop/tools/spawn-agent';
import type { SpawnAgentDeps } from '../../../src/core/loop/tools/spawn-agent';
import type { AgentDefinition, SubagentRecord } from '../../../src/core/types';

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

export function makeAgent(overrides?: Partial<AgentDefinition>): AgentDefinition {
  return {
    name: 'test-agent',
    description: 'A test agent',
    model: 'inherit',
    tools: ['Read', 'Write', 'Bash'],
    color: 'blue',
    systemPrompt: 'You are a test agent.',
    pluginId: 'core',
    ...overrides,
  };
}

export function makeRecord(overrides?: Partial<SubagentRecord>): SubagentRecord {
  return {
    id: 'rec-001',
    agentName: 'test-agent',
    parentId: null,
    taskDescription: 'Do something',
    status: 'completed',
    spawnedAt: Date.now(),
    timeoutMs: 300000,
    result: 'Task completed successfully.',
    tokensUsed: 100,
    toolUses: 2,
    completedAt: Date.now(),
    ...overrides,
  };
}

export function makeDeps(overrides?: Partial<SpawnAgentDeps>): SpawnAgentDeps {
  const agents: AgentDefinition[] = [
    makeAgent(),
    makeAgent({ name: 'general', description: 'General agent' }),
    makeAgent({ name: 'explore', description: 'Explore agent', tools: ['Read', 'Glob', 'Grep'] }),
  ];

  return {
    spawnSubagent: async (_name: string, _task: string, _opts?: unknown) => makeRecord(),
    listAgents: () => agents,
    getAgent: (name: string) => agents.find(a => a.name === name),
    currentDepth: 0,
    parentId: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tool Definition Tests
// ---------------------------------------------------------------------------

describe('SpawnAgent Tool', () => {
  describe('Tool Definition', () => {
    it('should have correct name and schema', () => {
      expect(spawnAgentTool.name).toBe('SpawnAgent');
      expect(spawnAgentTool.inputSchema.type).toBe('object');
      expect(spawnAgentTool.inputSchema.required).toEqual(['task']);
    });

    it('should be marked as concurrency safe', () => {
      expect(spawnAgentTool.isConcurrencySafe).toBe(true);
    });

    it('should have a description', () => {
      expect(spawnAgentTool.description).toBeTruthy();
      expect(spawnAgentTool.description.length).toBeGreaterThan(10);
    });

    it('should have agent_name, task, timeout, and tools properties', () => {
      const props = spawnAgentTool.inputSchema.properties;
      expect(props).toHaveProperty('agent_name');
      expect(props).toHaveProperty('task');
      expect(props).toHaveProperty('timeout');
      expect(props).toHaveProperty('tools');
    });
  });

  // ---------------------------------------------------------------------------
  // Factory Tests
  // ---------------------------------------------------------------------------

  describe('createSpawnAgentTool', () => {
    it('should return definition and executor', () => {
      const deps = makeDeps();
      const { definition, execute } = createSpawnAgentTool(deps);
      expect(definition).toBe(spawnAgentTool);
      expect(typeof execute).toBe('function');
    });
  });

  // ---------------------------------------------------------------------------
  // Spawn by Name Tests
  // ---------------------------------------------------------------------------

  describe('spawn agent by name', () => {
    let deps: SpawnAgentDeps;
    let execute: (id: string, input: Record<string, unknown>) => Promise<{ toolUseId: string; content: string; isError?: boolean }>;

    beforeEach(() => {
      deps = makeDeps();
      ({ execute } = createSpawnAgentTool(deps));
    });

    it('should spawn an agent by name and return result', async () => {
      const res = await execute('tu-1', { agent_name: 'test-agent', task: 'Do the thing' });
      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('[test-agent]');
      expect(res.content).toContain('Task completed successfully.');
    });

    it('should pass agent_name to spawnSubagent', async () => {
      let capturedName = '';
      deps.spawnSubagent = async (name: string, _task: string) => {
        capturedName = name;
        return makeRecord({ agentName: name });
      };
      const { execute: exec } = createSpawnAgentTool(deps);

      await exec('tu-2', { agent_name: 'explore', task: 'Explore the code' });
      expect(capturedName).toBe('explore');
    });

    it('should pass task to spawnSubagent', async () => {
      let capturedTask = '';
      deps.spawnSubagent = async (_name: string, task: string) => {
        capturedTask = task;
        return makeRecord();
      };
      const { execute: exec } = createSpawnAgentTool(deps);

      await exec('tu-3', { agent_name: 'test-agent', task: 'Build the feature' });
      expect(capturedTask).toBe('Build the feature');
    });

    it('should pass timeout and tools to spawnSubagent options', async () => {
      let capturedOpts: Record<string, unknown> = {};
      deps.spawnSubagent = async (_name: string, _task: string, opts?: unknown) => {
        capturedOpts = opts as Record<string, unknown>;
        return makeRecord();
      };
      const { execute: exec } = createSpawnAgentTool(deps);

      await exec('tu-4', {
        agent_name: 'test-agent',
        task: 'Do it',
        timeout: 60000,
        tools: ['Read', 'Bash'],
      });
      expect(capturedOpts.timeout).toBe(60000);
      expect(capturedOpts.tools).toEqual(['Read', 'Bash']);
    });
  });
});
