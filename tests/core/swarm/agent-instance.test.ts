/**
 * SwarmAgentInstance Tests
 * Tests individual agent execution, stop behavior, and callbacks within a swarm.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { SwarmAgentInstance } from '../../../src/core/swarm/agent-instance';
import type { SwarmAgentInstanceConfig } from '../../../src/core/swarm/agent-instance';
import { SwarmMessageBus } from '../../../src/core/swarm/message-bus';
import { EventBus } from '../../../src/core/event-bus';
import type { SwarmAgent } from '../../../src/core/swarm/types';
import type { AgentDefinition, SubagentRecord } from '../../../src/core/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function makeSwarmAgent(overrides?: Partial<SwarmAgent>): SwarmAgent {
  return {
    id: 'swarm-agent-1',
    name: 'test-worker',
    role: 'Test worker',
    status: 'idle',
    taskIds: [],
    ...overrides,
  };
}

function makeAgentDefinition(): AgentDefinition {
  return {
    name: 'test-worker',
    description: 'Test worker agent',
    model: 'inherit',
    tools: ['Read', 'Write'],
    color: 'blue',
    systemPrompt: 'You are a test worker.',
    pluginId: 'core',
  };
}

function makeRecord(overrides?: Partial<SubagentRecord>): SubagentRecord {
  return {
    id: 'rec-001',
    agentName: 'test-worker',
    parentId: null,
    taskDescription: 'Do something',
    status: 'completed',
    spawnedAt: Date.now(),
    timeoutMs: 300000,
    result: 'Task done successfully',
    tokensUsed: 100,
    toolUses: 2,
    completedAt: Date.now(),
    ...overrides,
  };
}

interface MockRegistryConfig {
  agentDef?: AgentDefinition;
  spawnResult?: SubagentRecord;
  spawnError?: Error;
}

function createMockRegistry(config?: MockRegistryConfig) {
  const agentDef = config?.agentDef ?? makeAgentDefinition();
  const spawnResult = config?.spawnResult ?? makeRecord();
  const spawnError = config?.spawnError;

  return {
    getAgent: (name: string) => name === agentDef.name ? agentDef : undefined,
    hasAgent: (name: string) => name === agentDef.name,
    spawnSubagent: async (_name: string, _task: string, _opts?: unknown) => {
      if (spawnError) throw spawnError;
      return spawnResult;
    },
    listAgents: () => [agentDef],
    registerAgent: () => {},
  } as unknown as import('../../../src/core/agent-registry').AgentRegistry;
}

function createTestDeps(overrides?: Partial<SwarmAgentInstanceConfig>): SwarmAgentInstanceConfig {
  const eventBus = new EventBus();
  const messageBus = new SwarmMessageBus(eventBus);
  const agent = makeSwarmAgent();

  messageBus.registerAgent(agent.id);

  return {
    agent,
    registry: createMockRegistry(),
    messageBus,
    onComplete: () => {},
    onFail: () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SwarmAgentInstance', () => {
  // -----------------------------------------------------------------------
  // execute()
  // -----------------------------------------------------------------------

  describe('execute', () => {
    it('should execute a task and return the result', async () => {
      const deps = createTestDeps();
      const instance = new SwarmAgentInstance(deps);

      const result = await instance.execute('Build the feature');
      expect(result).toBe('Task done successfully');
    });

    it('should set status to working during execution', async () => {
      let capturedStatus: string | null = null;

      const registry = createMockRegistry({
        spawnResult: makeRecord(),
      });

      // Override spawnSubagent to capture status mid-execution
      const origSpawn = registry.spawnSubagent.bind(registry);
      (registry as { spawnSubagent: typeof origSpawn }).spawnSubagent = async (
        name: string,
        task: string,
        opts?: unknown,
      ) => {
        capturedStatus = deps.agent.status;
        return origSpawn(name, task, opts as Parameters<typeof origSpawn>[2]);
      };

      const deps = createTestDeps({ registry });
      const instance = new SwarmAgentInstance(deps);

      await instance.execute('Test task');
      expect(capturedStatus).toBe('working');
    });

    it('should set status to done after successful completion', async () => {
      const deps = createTestDeps();
      const instance = new SwarmAgentInstance(deps);

      await instance.execute('Test task');
      expect(deps.agent.status).toBe('done');
    });

    it('should call onComplete callback on success', async () => {
      let completedId = '';
      let completedResult = '';

      const deps = createTestDeps({
        onComplete: (id, result) => {
          completedId = id;
          completedResult = result;
        },
      });

      const instance = new SwarmAgentInstance(deps);
      await instance.execute('Test task');

      expect(completedId).toBe(deps.agent.id);
      expect(completedResult).toBe('Task done successfully');
    });

    it('should call onFail callback on failure', async () => {
      let failedId = '';
      let failedError = '';

      const registry = createMockRegistry({
        spawnResult: makeRecord({ status: 'failed', result: 'Something went wrong' }),
      });

      const deps = createTestDeps({
        registry,
        onFail: (id, error) => {
          failedId = id;
          failedError = error;
        },
      });

      const instance = new SwarmAgentInstance(deps);

      try {
        await instance.execute('Bad task');
      } catch {
        // Expected
      }

      expect(failedId).toBe(deps.agent.id);
      expect(failedError).toBe('Something went wrong');
    });

    it('should set status to failed on failure', async () => {
      const registry = createMockRegistry({
        spawnResult: makeRecord({ status: 'failed', result: 'Error' }),
      });

      const deps = createTestDeps({ registry });
      const instance = new SwarmAgentInstance(deps);

      try {
        await instance.execute('Bad task');
      } catch {
        // Expected
      }

      expect(deps.agent.status).toBe('failed');
    });

    it('should handle timeout status', async () => {
      let failedError = '';
      const registry = createMockRegistry({
        spawnResult: makeRecord({ status: 'timeout', timeoutMs: 5000 }),
      });

      const deps = createTestDeps({
        registry,
        onFail: (_id, error) => { failedError = error; },
      });

      const instance = new SwarmAgentInstance(deps);

      try {
        await instance.execute('Slow task');
      } catch {
        // Expected
      }

      expect(failedError).toContain('timed out');
      expect(deps.agent.status).toBe('failed');
    });

    it('should throw if agent is already stopped', async () => {
      const deps = createTestDeps();
      const instance = new SwarmAgentInstance(deps);

      instance.stop();

      await expect(instance.execute('Task')).rejects.toThrow('has been stopped');
    });

    it('should handle registry spawnSubagent throwing an error', async () => {
      let failedError = '';
      const registry = createMockRegistry({
        spawnError: new Error('Registry exploded'),
      });

      const deps = createTestDeps({
        registry,
        onFail: (_id, error) => { failedError = error; },
      });

      const instance = new SwarmAgentInstance(deps);

      try {
        await instance.execute('Task');
      } catch {
        // Expected
      }

      expect(failedError).toContain('Registry exploded');
    });

    it('should handle agent definition not found', async () => {
      const registry = createMockRegistry();
      // Override getAgent to return undefined
      (registry as { getAgent: (n: string) => undefined }).getAgent = () => undefined;

      const deps = createTestDeps({ registry });
      const instance = new SwarmAgentInstance(deps);

      await expect(instance.execute('Task')).rejects.toThrow('not found in registry');
    });

    it('should include pending messages in task prompt', async () => {
      let capturedTask = '';
      const registry = createMockRegistry();

      (registry as { spawnSubagent: (...args: unknown[]) => Promise<SubagentRecord> }).spawnSubagent =
        async (_name: string, task: string) => {
          capturedTask = task;
          return makeRecord();
        };

      const eventBus = new EventBus();
      const messageBus = new SwarmMessageBus(eventBus);
      const agent = makeSwarmAgent();
      messageBus.registerAgent(agent.id);
      messageBus.registerAgent('other-agent');

      // Queue a message for the agent
      messageBus.send({
        id: '', from: 'other-agent', to: agent.id,
        type: 'message', content: 'Check the API first',
        timestamp: Date.now(),
      });

      const deps = createTestDeps({ agent, registry, messageBus });
      const instance = new SwarmAgentInstance(deps);

      await instance.execute('Build feature');

      expect(capturedTask).toContain('Build feature');
      expect(capturedTask).toContain('Check the API first');
    });
  });

  // -----------------------------------------------------------------------
  // stop()
  // -----------------------------------------------------------------------

  describe('stop', () => {
    it('should mark the instance as stopped', () => {
      const deps = createTestDeps();
      const instance = new SwarmAgentInstance(deps);

      expect(instance.isStopped()).toBe(false);
      instance.stop();
      expect(instance.isStopped()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  describe('accessors', () => {
    it('should expose agentId', () => {
      const agent = makeSwarmAgent({ id: 'custom-id' });
      const deps = createTestDeps({ agent });
      const instance = new SwarmAgentInstance(deps);
      expect(instance.agentId).toBe('custom-id');
    });

    it('should expose agentName', () => {
      const deps = createTestDeps();
      const instance = new SwarmAgentInstance(deps);
      expect(instance.agentName).toBe('test-worker');
    });

    it('should expose status', () => {
      const deps = createTestDeps();
      const instance = new SwarmAgentInstance(deps);
      expect(instance.status).toBe('idle');
    });
  });
});
