/**
 * Agent Output Streaming Tests (Phase 2.3)
 * Tests subagent:stream event handling and accumulated output.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { EventBus } from '../../src/core/event-bus';
import { createSpawnAgentTool } from '../../src/core/loop/tools/spawn-agent';
import { makeRecord, makeDeps } from './loop/spawn-agent.test';

describe('Phase 2.3: Agent Output Streaming', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  describe('subagent:stream event type', () => {
    it('should support subagent:stream event subscription', () => {
      let received = false;
      eventBus.on('subagent:stream', () => {
        received = true;
      });

      eventBus.emit('subagent:stream', {
        subagentId: 'agent-1',
        chunk: 'Hello',
        type: 'text_delta',
      });

      expect(received).toBe(true);
    });

    it('should pass text_delta stream events with correct payload', async () => {
      const events: Array<{ subagentId: string; chunk: string; type: string }> = [];
      eventBus.on('subagent:stream', (payload) => {
        events.push(payload);
      });

      await eventBus.emit('subagent:stream', {
        subagentId: 'agent-1',
        chunk: 'Hello world',
        type: 'text_delta',
      });

      expect(events).toHaveLength(1);
      expect(events[0]!.subagentId).toBe('agent-1');
      expect(events[0]!.chunk).toBe('Hello world');
      expect(events[0]!.type).toBe('text_delta');
    });

    it('should pass tool_use stream events with correct payload', async () => {
      const events: Array<{ subagentId: string; chunk: string; type: string }> = [];
      eventBus.on('subagent:stream', (payload) => {
        events.push(payload);
      });

      await eventBus.emit('subagent:stream', {
        subagentId: 'agent-2',
        chunk: '[Tool: Read]',
        type: 'tool_use',
      });

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('tool_use');
      expect(events[0]!.chunk).toBe('[Tool: Read]');
    });

    it('should pass tool_result stream events with correct payload', async () => {
      const events: Array<{ subagentId: string; chunk: string; type: string }> = [];
      eventBus.on('subagent:stream', (payload) => {
        events.push(payload);
      });

      await eventBus.emit('subagent:stream', {
        subagentId: 'agent-3',
        chunk: 'File contents here',
        type: 'tool_result',
      });

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('tool_result');
    });

    it('should emit multiple stream events in order', async () => {
      const events: string[] = [];
      eventBus.on('subagent:stream', (payload) => {
        events.push(payload.chunk);
      });

      await eventBus.emit('subagent:stream', { subagentId: 'a', chunk: 'first', type: 'text_delta' });
      await eventBus.emit('subagent:stream', { subagentId: 'a', chunk: 'second', type: 'text_delta' });
      await eventBus.emit('subagent:stream', { subagentId: 'a', chunk: 'third', type: 'text_delta' });

      expect(events).toEqual(['first', 'second', 'third']);
    });
  });

  describe('SpawnAgent returns accumulated output', () => {
    it('should return the subagent result content in tool output', async () => {
      const deps = makeDeps({
        spawnSubagent: async () => makeRecord({ result: 'Analyzed 10 files successfully.' }),
      });
      const { execute } = createSpawnAgentTool(deps);

      const res = await execute('tu-s1', { agent_name: 'test-agent', task: 'Analyze the codebase' });
      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('Analyzed 10 files successfully.');
    });

    it('should include agent name prefix in accumulated output', async () => {
      const deps = makeDeps({
        spawnSubagent: async () => makeRecord({ agentName: 'explore', result: 'Found 5 test files.' }),
      });
      const { execute } = createSpawnAgentTool(deps);

      const res = await execute('tu-s2', { agent_name: 'explore', task: 'Find test files' });
      expect(res.content).toContain('[explore]');
      expect(res.content).toContain('Found 5 test files.');
    });

    it('should handle empty output gracefully', async () => {
      const deps = makeDeps({
        spawnSubagent: async () => makeRecord({ result: undefined }),
      });
      const { execute } = createSpawnAgentTool(deps);

      const res = await execute('tu-s3', { agent_name: 'test-agent', task: 'Silent task' });
      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('no output');
    });
  });
});
