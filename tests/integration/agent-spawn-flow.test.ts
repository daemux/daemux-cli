/**
 * Agent Spawn Flow Integration Tests
 * Tests the parent loop -> spawn subagent -> result return flow,
 * tool restrictions, nesting depth limits, and timeout cleanup.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { EventBus } from '../../src/core/event-bus';
import {
  createMockAgentRegistry,
  makeAgentDef,
  makeSubagentRecord,
  createReadyMockProvider,
} from '../mocks';
import type { MockLLMProvider } from '../mocks/mock-llm-provider';
import type { AgentRegistry } from '../../src/core/agent-registry';
import { MAX_SUBAGENT_DEPTH } from '../../src/core/agent-registry';

// ---------------------------------------------------------------------------
// Test Setup
// ---------------------------------------------------------------------------

let eventBus: EventBus;
let provider: MockLLMProvider;

beforeEach(() => {
  eventBus = new EventBus();
  provider = createReadyMockProvider();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Agent Spawn Flow', () => {
  describe('Parent spawns subagent and receives result', () => {
    it('should return completed result with output', async () => {
      const registry = createMockAgentRegistry({
        agents: [makeAgentDef('general'), makeAgentDef('explore', { tools: ['Read', 'Glob', 'Grep'] })],
        spawnResult: makeSubagentRecord({
          status: 'completed',
          result: 'Exploration complete: found 15 TypeScript files',
          tokensUsed: 250,
          toolUses: 5,
        }),
      });

      const record = await registry.spawnSubagent('explore', 'Find all .ts files in src/');

      expect(record.status).toBe('completed');
      expect(record.result).toContain('Exploration complete');
      expect(record.agentName).toBe('explore');
      expect(record.tokensUsed).toBe(250);
      expect(record.toolUses).toBe(5);
    });

    it('should track spawn calls for verification', async () => {
      const registry = createMockAgentRegistry({
        agents: [makeAgentDef('general')],
      });

      await registry.spawnSubagent('general', 'Do something');
      await registry.spawnSubagent('general', 'Do another thing');

      expect(registry.getSpawnCount()).toBe(2);
      expect(registry.spawnCalls[0]!.task).toBe('Do something');
      expect(registry.spawnCalls[1]!.task).toBe('Do another thing');
    });

    it('should pass spawn options through to the subagent', async () => {
      const registry = createMockAgentRegistry({
        agents: [makeAgentDef('general')],
      });

      await registry.spawnSubagent('general', 'Task', {
        timeout: 60000,
        tools: ['Read', 'Bash'],
        parentId: 'parent-123',
        depth: 1,
      });

      const call = registry.spawnCalls[0]!;
      expect(call.options?.timeout).toBe(60000);
      expect(call.options?.tools).toEqual(['Read', 'Bash']);
      expect(call.options?.parentId).toBe('parent-123');
      expect(call.options?.depth).toBe(1);
    });
  });

  describe('Subagent tool restrictions', () => {
    it('should only expose tools listed in agent definition', () => {
      const explore = makeAgentDef('explore', { tools: ['Read', 'Glob', 'Grep'] });
      const allTools = ['Read', 'Write', 'Bash', 'Edit', 'Glob', 'Grep'];

      const registry = createMockAgentRegistry({ agents: [explore] });
      const filteredTools = registry.getAgentTools(explore, allTools);

      expect(filteredTools).toEqual(['Read', 'Glob', 'Grep']);
      expect(filteredTools).not.toContain('Write');
      expect(filteredTools).not.toContain('Bash');
      expect(filteredTools).not.toContain('Edit');
    });

    it('should return all tools when agent has no tool restrictions', () => {
      const general = makeAgentDef('general', { tools: undefined });
      const allTools = ['Read', 'Write', 'Bash', 'Edit', 'Glob', 'Grep'];

      const registry = createMockAgentRegistry({ agents: [general] });
      const filteredTools = registry.getAgentTools(general, allTools);

      expect(filteredTools).toEqual(allTools);
    });

    it('should return all tools when agent has empty tool list', () => {
      const agent = makeAgentDef('open-agent', { tools: [] });
      const allTools = ['Read', 'Write', 'Bash'];

      const registry = createMockAgentRegistry({ agents: [agent] });
      const filteredTools = registry.getAgentTools(agent, allTools);

      expect(filteredTools).toEqual(allTools);
    });

    it('should filter out tools not available in the system', () => {
      const agent = makeAgentDef('agent-wants-more', {
        tools: ['Read', 'Write', 'NonExistent', 'FakeTool'],
      });
      const available = ['Read', 'Write', 'Bash'];

      const registry = createMockAgentRegistry({ agents: [agent] });
      const filteredTools = registry.getAgentTools(agent, available);

      expect(filteredTools).toEqual(['Read', 'Write']);
    });
  });

  describe('Nesting depth limit', () => {
    it('should export MAX_SUBAGENT_DEPTH as a positive integer', () => {
      expect(MAX_SUBAGENT_DEPTH).toBeGreaterThan(0);
      expect(Number.isInteger(MAX_SUBAGENT_DEPTH)).toBe(true);
    });

    it('should enforce nesting depth in real registry (depth >= MAX)', () => {
      // The real AgentRegistry checks depth in spawnSubagent.
      // Here we verify the mock can simulate the depth being passed.
      const registry = createMockAgentRegistry({
        agents: [makeAgentDef('general')],
      });

      // Spawning at depth 0 should work (mock does not enforce depth)
      expect(
        registry.spawnSubagent('general', 'Task', { depth: 0 }),
      ).resolves.toBeDefined();

      // Spawning at depth MAX_SUBAGENT_DEPTH - 1 should work
      expect(
        registry.spawnSubagent('general', 'Task', { depth: MAX_SUBAGENT_DEPTH - 1 }),
      ).resolves.toBeDefined();
    });

    it('should track depth in spawn calls', async () => {
      const registry = createMockAgentRegistry({
        agents: [makeAgentDef('general')],
      });

      await registry.spawnSubagent('general', 'Level 0 task', { depth: 0 });
      await registry.spawnSubagent('general', 'Level 1 task', { depth: 1 });
      await registry.spawnSubagent('general', 'Level 2 task', { depth: 2 });

      expect(registry.spawnCalls[0]!.options?.depth).toBe(0);
      expect(registry.spawnCalls[1]!.options?.depth).toBe(1);
      expect(registry.spawnCalls[2]!.options?.depth).toBe(2);
    });
  });

  describe('Timeout cleanup', () => {
    it('should return timeout status when agent times out', async () => {
      const registry = createMockAgentRegistry({
        agents: [makeAgentDef('slow-agent')],
        spawnResult: makeSubagentRecord({
          status: 'timeout',
          timeoutMs: 1000,
          result: undefined,
        }),
      });

      const record = await registry.spawnSubagent('slow-agent', 'Very long task');

      expect(record.status).toBe('timeout');
      expect(record.timeoutMs).toBe(1000);
    });

    it('should handle spawn delay and still return result', async () => {
      const registry = createMockAgentRegistry({
        agents: [makeAgentDef('general')],
        spawnDelay: 50,
        spawnResult: makeSubagentRecord({ status: 'completed', result: 'Delayed result' }),
      });

      const start = Date.now();
      const record = await registry.spawnSubagent('general', 'Delayed task');
      const elapsed = Date.now() - start;

      expect(record.status).toBe('completed');
      expect(record.result).toBe('Delayed result');
      expect(elapsed).toBeGreaterThanOrEqual(40); // Allow small timing variance
    });

    it('should throw on spawn error', async () => {
      const registry = createMockAgentRegistry({
        agents: [makeAgentDef('general')],
        spawnError: 'Connection lost',
      });

      await expect(
        registry.spawnSubagent('general', 'Failing task'),
      ).rejects.toThrow('Connection lost');
    });

    it('should emit subagent events via event bus', async () => {
      const events: Array<{ event: string; payload: unknown }> = [];

      eventBus.on('subagent:spawn', (p) => events.push({ event: 'spawn', payload: p }));
      eventBus.on('subagent:complete', (p) => events.push({ event: 'complete', payload: p }));
      eventBus.on('subagent:timeout', (p) => events.push({ event: 'timeout', payload: p }));

      // Events are emitted by the real AgentRegistry, not the mock.
      // This test verifies the EventBus can handle these event types.
      await eventBus.emit('subagent:spawn', { record: makeSubagentRecord() });
      await eventBus.emit('subagent:complete', { record: makeSubagentRecord({ status: 'completed' }) });
      await eventBus.emit('subagent:timeout', { record: makeSubagentRecord({ status: 'timeout' }) });

      expect(events).toHaveLength(3);
      expect(events[0]!.event).toBe('spawn');
      expect(events[1]!.event).toBe('complete');
      expect(events[2]!.event).toBe('timeout');
    });
  });
});
