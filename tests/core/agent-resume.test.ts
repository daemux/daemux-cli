/**
 * Agent Resume Tests (Phase 2.4)
 * Tests resume parameter handling, session resolution, and streaming+resume integration.
 */

import { describe, it, expect } from 'bun:test';
import { createSpawnAgentTool } from '../../src/core/loop/tools/spawn-agent';
import { makeRecord, makeDeps } from './loop/spawn-agent.test';

describe('Phase 2.4: Agent Resume', () => {
  describe('resume parameter in SpawnAgent tool schema', () => {
    it('should have resume property in input schema', async () => {
      const { spawnAgentTool } = await import('../../src/core/loop/tools/spawn-agent');
      const props = spawnAgentTool.inputSchema.properties;
      expect(props).toHaveProperty('resume');
      expect((props.resume as { type: string }).type).toBe('string');
    });
  });

  describe('resume with valid session ID', () => {
    it('should pass resumeSessionId to spawnSubagent', async () => {
      let capturedOpts: Record<string, unknown> = {};
      const deps = makeDeps({
        getSubagentSessionId: (recordId: string) => {
          if (recordId === 'rec-prev') return 'session-xyz';
          return undefined;
        },
        spawnSubagent: async (_name: string, _task: string, opts?: unknown) => {
          capturedOpts = opts as Record<string, unknown>;
          return makeRecord();
        },
      });
      const { execute } = createSpawnAgentTool(deps);

      await execute('tu-r1', {
        agent_name: 'test-agent',
        task: 'Continue where we left off',
        resume: 'rec-prev',
      });

      expect(capturedOpts.resumeSessionId).toBe('session-xyz');
    });

    it('should resume and return the completed result', async () => {
      const deps = makeDeps({
        getSubagentSessionId: () => 'session-abc',
        spawnSubagent: async () => makeRecord({
          result: 'Resumed and completed the refactoring.',
        }),
      });
      const { execute } = createSpawnAgentTool(deps);

      const res = await execute('tu-r2', {
        agent_name: 'test-agent',
        task: 'Finish the refactoring',
        resume: 'rec-old',
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('Resumed and completed the refactoring.');
    });
  });

  describe('resume appends new task to history', () => {
    it('should pass the new task string to spawnSubagent', async () => {
      let capturedTask = '';
      const deps = makeDeps({
        getSubagentSessionId: () => 'session-abc',
        spawnSubagent: async (_name: string, task: string) => {
          capturedTask = task;
          return makeRecord();
        },
      });
      const { execute } = createSpawnAgentTool(deps);

      await execute('tu-r3', {
        agent_name: 'test-agent',
        task: 'Now also add error handling',
        resume: 'rec-prev',
      });

      expect(capturedTask).toBe('Now also add error handling');
    });
  });

  describe('resume with invalid session ID', () => {
    it('should return error when session is not found', async () => {
      const deps = makeDeps({ getSubagentSessionId: () => undefined });
      const { execute } = createSpawnAgentTool(deps);

      const res = await execute('tu-r4', {
        agent_name: 'test-agent',
        task: 'Continue work',
        resume: 'nonexistent-record',
      });

      expect(res.isError).toBe(true);
      expect(res.content).toContain('No session found');
      expect(res.content).toContain('nonexistent-record');
    });

    it('should return error when getSubagentSessionId is not available', async () => {
      const deps = makeDeps({ getSubagentSessionId: undefined });
      const { execute } = createSpawnAgentTool(deps);

      const res = await execute('tu-r5', {
        agent_name: 'test-agent',
        task: 'Continue work',
        resume: 'some-record',
      });

      expect(res.isError).toBe(true);
      expect(res.content).toContain('Resume is not supported');
    });
  });

  describe('session saved after completion', () => {
    it('should store session ID mapping for completed subagent', async () => {
      const sessionMap = new Map<string, string>();
      sessionMap.set('rec-001', 'loop-session-123');

      const deps = makeDeps({
        getSubagentSessionId: (recordId: string) => sessionMap.get(recordId),
      });
      const { execute } = createSpawnAgentTool(deps);

      const session = deps.getSubagentSessionId!('rec-001');
      expect(session).toBe('loop-session-123');

      const res = await execute('tu-r6', {
        agent_name: 'test-agent',
        task: 'Continue from previous session',
        resume: 'rec-001',
      });

      expect(res.isError).toBeFalsy();
    });

    it('should not have session for subagent that never ran', () => {
      const sessionMap = new Map<string, string>();
      const deps = makeDeps({
        getSubagentSessionId: (recordId: string) => sessionMap.get(recordId),
      });

      const session = deps.getSubagentSessionId!('never-ran');
      expect(session).toBeUndefined();
    });
  });

  describe('resume does not interfere with normal spawn', () => {
    it('should not pass resumeSessionId when resume is not specified', async () => {
      let capturedOpts: Record<string, unknown> = {};
      const deps = makeDeps({
        getSubagentSessionId: () => 'session-should-not-be-used',
        spawnSubagent: async (_name: string, _task: string, opts?: unknown) => {
          capturedOpts = opts as Record<string, unknown>;
          return makeRecord();
        },
      });
      const { execute } = createSpawnAgentTool(deps);

      await execute('tu-r7', {
        agent_name: 'test-agent',
        task: 'Fresh task without resume',
      });

      expect(capturedOpts.resumeSessionId).toBeUndefined();
    });
  });
});

describe('Streaming + Resume Integration', () => {
  it('should handle resume with streaming output', async () => {
    const deps = makeDeps({
      getSubagentSessionId: () => 'session-abc',
      spawnSubagent: async () => makeRecord({
        result: 'Resumed with streaming: analysis complete.',
      }),
    });
    const { execute } = createSpawnAgentTool(deps);

    const res = await execute('tu-i1', {
      agent_name: 'test-agent',
      task: 'Continue and analyze',
      resume: 'rec-prev',
    });

    expect(res.isError).toBeFalsy();
    expect(res.content).toContain('analysis complete');
  });

  it('should propagate timeout error during resumed session', async () => {
    const deps = makeDeps({
      getSubagentSessionId: () => 'session-abc',
      spawnSubagent: async () => makeRecord({ status: 'timeout', timeoutMs: 30000 }),
    });
    const { execute } = createSpawnAgentTool(deps);

    const res = await execute('tu-i2', {
      agent_name: 'test-agent',
      task: 'This will timeout',
      resume: 'rec-prev',
    });

    expect(res.isError).toBe(true);
    expect(res.content).toContain('timed out');
  });

  it('should propagate failure during resumed session', async () => {
    const deps = makeDeps({
      getSubagentSessionId: () => 'session-abc',
      spawnSubagent: async () => makeRecord({ status: 'failed', result: 'Error: out of memory' }),
    });
    const { execute } = createSpawnAgentTool(deps);

    const res = await execute('tu-i3', {
      agent_name: 'test-agent',
      task: 'This will fail',
      resume: 'rec-prev',
    });

    expect(res.isError).toBe(true);
    expect(res.content).toContain('failed');
    expect(res.content).toContain('out of memory');
  });
});
