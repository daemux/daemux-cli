/**
 * SwarmCoordinator Tests
 * Tests swarm creation, agent planning, execution, timeout, and failure handling.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { SwarmCoordinator } from '../../../src/core/swarm';
import { EventBus } from '../../../src/core/event-bus';
import type { AgentDefinition, SubagentRecord } from '../../../src/core/types';
import type { AgentFactory } from '../../../src/core/agent-factory';
import type { AgentRegistry } from '../../../src/core/agent-registry';
import { createReadyMockProvider, type MockLLMProvider } from '../../mocks/mock-llm-provider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgentDef(name: string): AgentDefinition {
  return {
    name,
    description: `Agent ${name}`,
    model: 'inherit',
    tools: ['Read', 'Write', 'Bash'],
    color: 'blue',
    systemPrompt: `You are ${name}.`,
    pluginId: 'core',
  };
}

function makeRecord(overrides?: Partial<SubagentRecord>): SubagentRecord {
  return {
    id: `rec-${Date.now()}`,
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

interface MockRegistryOptions {
  agents?: AgentDefinition[];
  spawnResult?: SubagentRecord;
  spawnDelay?: number;
}

function createMockRegistry(options?: MockRegistryOptions): AgentRegistry {
  const agents = options?.agents ?? [makeAgentDef('general')];
  const spawnResult = options?.spawnResult ?? makeRecord();
  const spawnDelay = options?.spawnDelay ?? 0;

  const agentMap = new Map(agents.map(a => [a.name, a]));

  return {
    getAgent: (name: string) => agentMap.get(name),
    hasAgent: (name: string) => agentMap.has(name),
    listAgents: () => agents,
    registerAgent: (agent: AgentDefinition) => { agentMap.set(agent.name, agent); },
    spawnSubagent: async (name: string, _task: string) => {
      if (spawnDelay > 0) {
        await new Promise(r => setTimeout(r, spawnDelay));
      }
      return makeRecord({ ...spawnResult, agentName: name });
    },
    resolveModel: () => 'claude-sonnet-4-20250514',
  } as unknown as AgentRegistry;
}

function createMockFactory(): AgentFactory {
  return {
    createAgent: async (taskDesc: string) => {
      const name = taskDesc.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20);
      return makeAgentDef(`dyn-${name}`);
    },
  } as unknown as AgentFactory;
}

interface CoordinatorTestContext {
  coordinator: SwarmCoordinator;
  eventBus: EventBus;
  provider: MockLLMProvider;
  registry: AgentRegistry;
}

function createCoordinator(overrides?: {
  registryOpts?: MockRegistryOptions;
  maxAgents?: number;
  timeoutMs?: number;
  planResponse?: string;
}): CoordinatorTestContext {
  const eventBus = new EventBus();
  const provider = createReadyMockProvider();
  const registry = createMockRegistry(overrides?.registryOpts);
  const agentFactory = createMockFactory();

  // Set up the planning response
  const planJson = overrides?.planResponse ?? JSON.stringify([
    { name: 'general', role: 'General worker', task: 'Execute the main task' },
  ]);
  provider.addTextResponse(planJson);

  const coordinator = new SwarmCoordinator({
    eventBus,
    config: {
      maxAgents: overrides?.maxAgents ?? 5,
      timeoutMs: overrides?.timeoutMs ?? 60000,
    },
    provider,
    registry,
    agentFactory,
  });

  return { coordinator, eventBus, provider, registry };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SwarmCoordinator', () => {
  // -----------------------------------------------------------------------
  // Basic Execution
  // -----------------------------------------------------------------------

  describe('execute', () => {
    it('should execute a swarm and return a result', async () => {
      const { coordinator } = createCoordinator();

      const result = await coordinator.execute('Build a REST API');

      expect(result.swarmId).toBeTruthy();
      expect(result.status).toBe('completed');
      expect(result.output).toBeTruthy();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should include agent results in output', async () => {
      const { coordinator } = createCoordinator();

      const result = await coordinator.execute('Build a feature');

      expect(result.output).toContain('general');
      expect(result.output).toContain('COMPLETED');
    });

    it('should use the planning prompt to create agents', async () => {
      const planJson = JSON.stringify([
        { name: 'general', role: 'Backend dev', task: 'Create API' },
        { name: 'general', role: 'Frontend dev', task: 'Create UI' },
      ]);
      const { coordinator, provider } = createCoordinator({ planResponse: planJson });

      await coordinator.execute('Full stack feature');

      // First call is the planning call
      const planCall = provider.getCallHistory()[0];
      expect(planCall).toBeDefined();
      expect(planCall!.systemPrompt).toContain('task planner');
    });
  });

  // -----------------------------------------------------------------------
  // Agent Planning
  // -----------------------------------------------------------------------

  describe('agent planning', () => {
    it('should limit agents to maxAgents config', async () => {
      const manyAgents = JSON.stringify([
        { name: 'general', role: 'A', task: 'T1' },
        { name: 'general', role: 'B', task: 'T2' },
        { name: 'general', role: 'C', task: 'T3' },
        { name: 'general', role: 'D', task: 'T4' },
      ]);

      const { coordinator } = createCoordinator({
        planResponse: manyAgents,
        maxAgents: 2,
      });

      const result = await coordinator.execute('Big task');
      const state = coordinator.getState();

      // Should only have 2 agents
      expect(state.agents.size).toBeLessThanOrEqual(2);
      expect(result.status).toBe('completed');
    });

    it('should fall back to single agent if planning fails', async () => {
      const { coordinator, provider } = createCoordinator();

      // Override the provider to fail on planning
      provider.reset();
      provider.addTextResponse('Not valid JSON at all!!!');
      // Second response is for the dynamic agent factory
      provider.addTextResponse(JSON.stringify({
        name: 'fallback-agent',
        description: 'Fallback',
        systemPrompt: 'Do the task',
        tools: ['Read'],
        model: 'inherit',
        color: 'blue',
      }));

      const result = await coordinator.execute('Some task');

      // Should still complete with a fallback agent
      expect(result.status).toBe('completed');
    });

    it('should handle empty plan response', async () => {
      const { coordinator, provider } = createCoordinator();

      provider.reset();
      provider.addTextResponse('[]');
      // Factory response for the general-worker fallback
      provider.addTextResponse(JSON.stringify({
        name: 'general-worker',
        description: 'General worker',
        systemPrompt: 'Do the task',
        tools: ['Read', 'Write'],
        model: 'inherit',
        color: 'blue',
      }));

      const result = await coordinator.execute('Task');
      expect(result.status).toBe('completed');
    });
  });

  // -----------------------------------------------------------------------
  // Agent Failure Handling
  // -----------------------------------------------------------------------

  describe('agent failure', () => {
    it('should handle agent spawn failure gracefully', async () => {
      const { coordinator } = createCoordinator({
        registryOpts: {
          spawnResult: makeRecord({ status: 'failed', result: 'Agent crashed' }),
        },
      });

      const result = await coordinator.execute('Failing task');

      // Swarm should still complete (even with failed agents)
      expect(result.output).toContain('Error');
    });

    it('should handle agent timeout', async () => {
      const { coordinator } = createCoordinator({
        registryOpts: {
          spawnResult: makeRecord({ status: 'timeout', timeoutMs: 1000 }),
        },
      });

      const result = await coordinator.execute('Slow task');
      expect(result.output).toContain('FAILED');
    });
  });

  // -----------------------------------------------------------------------
  // Stop
  // -----------------------------------------------------------------------

  describe('stop', () => {
    it('should stop the swarm immediately', () => {
      const { coordinator } = createCoordinator();

      // Stop before execute - should not throw
      expect(() => coordinator.stop()).not.toThrow();
    });

    it('should report failed status after stop', async () => {
      const { coordinator } = createCoordinator({
        registryOpts: { spawnDelay: 5000 },
      });

      // Start execution in background
      const resultPromise = coordinator.execute('Long task');

      // Stop immediately
      await new Promise(r => setTimeout(r, 50));
      coordinator.stop();

      const result = await resultPromise;
      expect(result.status).toBe('failed');
    });
  });

  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------

  describe('getState', () => {
    it('should return initial state before execution', () => {
      const { coordinator } = createCoordinator();

      const state = coordinator.getState();
      expect(state.id).toBeTruthy();
      expect(state.status).toBe('planning');
      expect(state.agents.size).toBe(0);
      expect(state.startedAt).toBeGreaterThan(0);
    });

    it('should update state after execution', async () => {
      const { coordinator } = createCoordinator();

      await coordinator.execute('Task');

      const state = coordinator.getState();
      expect(state.status).toBe('completed');
      expect(state.completedAt).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Event Bus Integration
  // -----------------------------------------------------------------------

  describe('event bus', () => {
    it('should emit swarm:agent-complete events', async () => {
      const completeEvents: Array<{ swarmId: string; agentId: string }> = [];
      const { coordinator, eventBus } = createCoordinator();

      eventBus.on('swarm:agent-complete', (payload) => {
        completeEvents.push(payload);
      });

      await coordinator.execute('Task');

      // Give events time to propagate
      await new Promise(r => setTimeout(r, 50));
      expect(completeEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('should emit swarm:agent-fail events on failure', async () => {
      const failEvents: Array<{ swarmId: string; agentId: string; error: string }> = [];
      const { coordinator, eventBus } = createCoordinator({
        registryOpts: {
          spawnResult: makeRecord({ status: 'failed', result: 'Boom' }),
        },
      });

      eventBus.on('swarm:agent-fail', (payload) => {
        failEvents.push(payload);
      });

      await coordinator.execute('Failing task');

      await new Promise(r => setTimeout(r, 50));
      expect(failEvents.length).toBeGreaterThanOrEqual(1);
    });
  });
});
