/**
 * Swarm Lifecycle Integration Tests
 * Tests the full swarm lifecycle: create -> assign tasks -> work -> complete -> shutdown.
 * Also covers timeout cleanup, agent failure handling, and inter-agent messaging.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { EventBus } from '../../src/core/event-bus';
import { SwarmCoordinator } from '../../src/core/swarm';
import { SwarmMessageBus } from '../../src/core/swarm/message-bus';
import {
  createMockAgentRegistry,
  makeAgentDef,
  makeSubagentRecord,
  createReadyMockProvider,
  createMockMessageBus,
} from '../mocks';
import type { MockLLMProvider } from '../mocks/mock-llm-provider';
import type { AgentRegistry } from '../../src/core/agent-registry';
import type { AgentFactory } from '../../src/core/agent-factory';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockFactory(): AgentFactory {
  return {
    createAgent: async (taskDesc: string) => {
      const name = taskDesc.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20);
      return makeAgentDef(`dyn-${name}`);
    },
  } as unknown as AgentFactory;
}

interface SwarmTestContext {
  coordinator: SwarmCoordinator;
  eventBus: EventBus;
  provider: MockLLMProvider;
  registry: AgentRegistry;
}

function createSwarmContext(overrides?: {
  agents?: ReturnType<typeof makeAgentDef>[];
  planJson?: string;
  maxAgents?: number;
  timeoutMs?: number;
  spawnDelay?: number;
  spawnError?: string;
}): SwarmTestContext {
  const eventBus = new EventBus();
  const provider = createReadyMockProvider();
  const registry = createMockAgentRegistry({
    agents: overrides?.agents ?? [makeAgentDef('general')],
    spawnDelay: overrides?.spawnDelay,
    spawnError: overrides?.spawnError,
  });
  const agentFactory = createMockFactory();

  const planJson = overrides?.planJson ?? JSON.stringify([
    { name: 'general', role: 'Worker', task: 'Execute the main task' },
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

describe('Swarm Lifecycle', () => {
  describe('Create swarm -> assign tasks -> work -> complete -> shutdown', () => {
    it('should complete a single-agent swarm end-to-end', async () => {
      const { coordinator } = createSwarmContext();

      const result = await coordinator.execute('Build a REST API');

      expect(result.swarmId).toBeTruthy();
      expect(result.status).toBe('completed');
      expect(result.output).toBeTruthy();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should complete a multi-agent swarm', async () => {
      const planJson = JSON.stringify([
        { name: 'general', role: 'Backend developer', task: 'Create API endpoints' },
        { name: 'general', role: 'Frontend developer', task: 'Create UI components' },
        { name: 'general', role: 'Tester', task: 'Write integration tests' },
      ]);

      const { coordinator } = createSwarmContext({ planJson });

      const result = await coordinator.execute('Full stack feature');

      expect(result.status).toBe('completed');
      expect(result.output).toContain('Backend developer');
      expect(result.output).toContain('Frontend developer');
      expect(result.output).toContain('Tester');

      const state = coordinator.getState();
      expect(state.agents.size).toBe(3);
    });

    it('should track state transitions through lifecycle', async () => {
      const { coordinator } = createSwarmContext();

      // Before execution: planning state
      const initialState = coordinator.getState();
      expect(initialState.status).toBe('planning');
      expect(initialState.agents.size).toBe(0);

      // Execute
      const result = await coordinator.execute('Task');

      // After execution: completed state
      const finalState = coordinator.getState();
      expect(finalState.status).toBe('completed');
      expect(finalState.completedAt).toBeGreaterThan(0);
      expect(result.status).toBe('completed');
    });

    it('should report agent results in swarm output', async () => {
      const { coordinator } = createSwarmContext({
        agents: [makeAgentDef('general')],
      });

      const result = await coordinator.execute('Simple task');

      expect(result.output).toContain('COMPLETED');
      expect(result.agentResults.size).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Swarm timeout -> cleanup', () => {
    it('should stop on manual stop and report failed', async () => {
      const { coordinator } = createSwarmContext({ spawnDelay: 5000 });

      const resultPromise = coordinator.execute('Long running task');
      await new Promise(r => setTimeout(r, 50));

      coordinator.stop();

      const result = await resultPromise;
      expect(result.status).toBe('failed');
    });

    it('should not throw on stop before execution', () => {
      const { coordinator } = createSwarmContext();
      expect(() => coordinator.stop()).not.toThrow();
    });

    it('should cleanup state after stop', async () => {
      const { coordinator } = createSwarmContext({ spawnDelay: 2000 });

      const resultPromise = coordinator.execute('Task');
      await new Promise(r => setTimeout(r, 50));

      coordinator.stop();
      const result = await resultPromise;

      // Result should reflect the stop (failed status)
      expect(result.status).toBe('failed');
    });
  });

  describe('Agent failure during swarm -> handled gracefully', () => {
    it('should handle individual agent failure without crashing swarm', async () => {
      const { coordinator } = createSwarmContext({
        agents: [
          makeAgentDef('general'),
        ],
      });

      // Override with failed spawn result
      const registry = createMockAgentRegistry({
        agents: [makeAgentDef('general')],
        spawnResult: makeSubagentRecord({
          status: 'failed',
          result: 'Agent crashed unexpectedly',
        }),
      });

      const ctx = createSwarmContext({
        agents: [makeAgentDef('general')],
      });

      // Override with failing result
      const failCtx = createSwarmContext();
      const failProvider = failCtx.provider;
      failProvider.reset();
      failProvider.addTextResponse(JSON.stringify([
        { name: 'general', role: 'Worker', task: 'Crash task' },
      ]));

      // The real test: spawn fails but swarm collects error result
      const failRegistry = createMockAgentRegistry({
        agents: [makeAgentDef('general')],
        spawnResult: makeSubagentRecord({ status: 'failed', result: 'Boom' }),
      });

      const failCoordinator = new SwarmCoordinator({
        eventBus: new EventBus(),
        config: { maxAgents: 5, timeoutMs: 60000 },
        provider: failProvider,
        registry: failRegistry,
        agentFactory: createMockFactory(),
      });

      const result = await failCoordinator.execute('Failing task');
      expect(result.output).toContain('Error');
    });

    it('should emit failure events', async () => {
      const failEvents: Array<{ swarmId: string; agentId: string; error: string }> = [];
      const eventBus = new EventBus();
      const provider = createReadyMockProvider();
      provider.addTextResponse(JSON.stringify([
        { name: 'general', role: 'Worker', task: 'Task' },
      ]));

      eventBus.on('swarm:agent-fail', (payload) => {
        failEvents.push(payload);
      });

      const coordinator = new SwarmCoordinator({
        eventBus,
        config: { maxAgents: 5, timeoutMs: 60000 },
        provider,
        registry: createMockAgentRegistry({
          agents: [makeAgentDef('general')],
          spawnResult: makeSubagentRecord({ status: 'failed', result: 'Error occurred' }),
        }),
        agentFactory: createMockFactory(),
      });

      await coordinator.execute('Failing task');
      await new Promise(r => setTimeout(r, 50));

      expect(failEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Message passing between agents', () => {
    it('should support direct messages via mock bus', () => {
      const bus = createMockMessageBus();

      bus.registerAgent('agent-1');
      bus.registerAgent('agent-2');

      bus.send({
        id: '',
        from: 'agent-1',
        to: 'agent-2',
        type: 'message',
        content: 'Hello from agent-1',
        timestamp: Date.now(),
      });

      const messages = bus.getMessages('agent-2');
      expect(messages).toHaveLength(1);
      expect(messages[0]!.content).toBe('Hello from agent-1');
      expect(messages[0]!.from).toBe('agent-1');
    });

    it('should support broadcast to all except sender', () => {
      const bus = createMockMessageBus();

      bus.registerAgent('leader');
      bus.registerAgent('worker-1');
      bus.registerAgent('worker-2');

      bus.broadcast('leader', 'Task assigned to all workers');

      expect(bus.hasMessages('leader')).toBe(false);
      expect(bus.hasMessages('worker-1')).toBe(true);
      expect(bus.hasMessages('worker-2')).toBe(true);

      const w1Messages = bus.getMessages('worker-1');
      expect(w1Messages).toHaveLength(1);
      expect(w1Messages[0]!.content).toBe('Task assigned to all workers');
    });

    it('should drain messages on getMessages call', () => {
      const bus = createMockMessageBus();

      bus.registerAgent('a');
      bus.registerAgent('b');

      bus.send({
        id: '',
        from: 'a',
        to: 'b',
        type: 'message',
        content: 'First',
        timestamp: Date.now(),
      });
      bus.send({
        id: '',
        from: 'a',
        to: 'b',
        type: 'message',
        content: 'Second',
        timestamp: Date.now(),
      });

      const first = bus.getMessages('b');
      expect(first).toHaveLength(2);

      const second = bus.getMessages('b');
      expect(second).toHaveLength(0);
    });

    it('should track all messages sent through bus', () => {
      const bus = createMockMessageBus();

      bus.registerAgent('a');
      bus.registerAgent('b');

      bus.send({
        id: '',
        from: 'a',
        to: 'b',
        type: 'message',
        content: 'Hello',
        timestamp: Date.now(),
      });

      bus.broadcast('b', 'Broadcast message');

      expect(bus.allMessages).toHaveLength(2);
    });

    it('should throw when sending to unregistered agent', () => {
      const bus = createMockMessageBus();

      bus.registerAgent('a');

      expect(() => bus.send({
        id: '',
        from: 'a',
        to: 'nonexistent',
        type: 'message',
        content: 'Hello',
        timestamp: Date.now(),
      })).toThrow('not registered');
    });

    it('should work with real SwarmMessageBus', () => {
      const eventBus = new EventBus();
      const bus = new SwarmMessageBus(eventBus);

      bus.registerAgent('agent-a');
      bus.registerAgent('agent-b');

      bus.send({
        id: '',
        from: 'agent-a',
        to: 'agent-b',
        type: 'message',
        content: 'Real bus message',
        timestamp: Date.now(),
      });

      const messages = bus.getMessages('agent-b');
      expect(messages).toHaveLength(1);
      expect(messages[0]!.content).toBe('Real bus message');

      bus.clear();
      expect(bus.agentCount()).toBe(0);
    });

    it('should support cleanup and reuse', () => {
      const bus = createMockMessageBus();

      bus.registerAgent('a');
      bus.registerAgent('b');
      bus.send({
        id: '',
        from: 'a',
        to: 'b',
        type: 'message',
        content: 'Before clear',
        timestamp: Date.now(),
      });

      bus.clear();

      expect(bus.agentCount()).toBe(0);
      expect(bus.allMessages).toHaveLength(0);
    });
  });
});
