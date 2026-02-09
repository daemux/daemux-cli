/**
 * SpawnAgent Tool Tests - Edge Cases
 * Tests depth limits, timeout, validation, error handling, and status edge cases.
 */

import { describe, it, expect } from 'bun:test';
import { createSpawnAgentTool } from '../../../src/core/loop/tools/spawn-agent';
import { makeAgent, makeRecord, makeDeps } from './spawn-agent.test';

// ---------------------------------------------------------------------------
// Spawn without Name (General Config)
// ---------------------------------------------------------------------------

describe('SpawnAgent Edge Cases', () => {
  describe('spawn without name uses general config', () => {
    it('should fall back to general agent when no name specified', async () => {
      let capturedName = '';
      const deps = makeDeps({
        spawnSubagent: async (name: string) => {
          capturedName = name;
          return makeRecord({ agentName: name });
        },
      });
      const { execute } = createSpawnAgentTool(deps);

      const res = await execute('tu-5', { task: 'Do something general' });
      expect(res.isError).toBeFalsy();
      expect(capturedName).toBe('general');
    });

    it('should fall back to first available agent when general not found', async () => {
      let capturedName = '';
      const agents = [makeAgent({ name: 'alpha' }), makeAgent({ name: 'beta' })];
      const deps = makeDeps({
        listAgents: () => agents,
        getAgent: (name: string) => agents.find(a => a.name === name),
        spawnSubagent: async (name: string) => {
          capturedName = name;
          return makeRecord({ agentName: name });
        },
      });
      const { execute } = createSpawnAgentTool(deps);

      await execute('tu-6', { task: 'Do something' });
      expect(capturedName).toBe('alpha');
    });

    it('should return error when no agents are registered at all', async () => {
      const deps = makeDeps({
        listAgents: () => [],
        getAgent: () => undefined,
      });
      const { execute } = createSpawnAgentTool(deps);

      const res = await execute('tu-7', { task: 'Do something' });
      expect(res.isError).toBe(true);
      expect(res.content).toContain('No agents registered');
    });
  });

  // ---------------------------------------------------------------------------
  // Agent Not Found
  // ---------------------------------------------------------------------------

  describe('agent not found', () => {
    it('should return error when named agent does not exist', async () => {
      const deps = makeDeps();
      const { execute } = createSpawnAgentTool(deps);

      const res = await execute('tu-8', { agent_name: 'nonexistent', task: 'Do the thing' });
      expect(res.isError).toBe(true);
      expect(res.content).toContain("Agent 'nonexistent' not found");
      expect(res.content).toContain('Available agents:');
    });

    it('should list available agents in the error message', async () => {
      const deps = makeDeps();
      const { execute } = createSpawnAgentTool(deps);

      const res = await execute('tu-9', { agent_name: 'missing', task: 'Do it' });
      expect(res.content).toContain('test-agent');
      expect(res.content).toContain('general');
      expect(res.content).toContain('explore');
    });
  });

  // ---------------------------------------------------------------------------
  // Nesting Depth Exceeded
  // ---------------------------------------------------------------------------

  describe('nesting depth exceeded', () => {
    it('should return error when depth limit is reached', async () => {
      const deps = makeDeps({
        currentDepth: 2,
        spawnSubagent: async () => {
          throw new Error('Maximum subagent nesting depth (3) exceeded. Cannot spawn \'test-agent\' at depth 3.');
        },
      });
      const { execute } = createSpawnAgentTool(deps);

      const res = await execute('tu-10', { agent_name: 'test-agent', task: 'Deep task' });
      expect(res.isError).toBe(true);
      expect(res.content).toContain('nesting depth');
    });

    it('should pass incremented depth to spawnSubagent', async () => {
      let capturedDepth = -1;
      const deps = makeDeps({
        currentDepth: 1,
        spawnSubagent: async (_name: string, _task: string, opts?: unknown) => {
          capturedDepth = (opts as { depth: number }).depth;
          return makeRecord();
        },
      });
      const { execute } = createSpawnAgentTool(deps);

      await execute('tu-11', { agent_name: 'test-agent', task: 'Nested task' });
      expect(capturedDepth).toBe(2);
    });

    it('should default currentDepth to 0 when not provided', async () => {
      let capturedDepth = -1;
      const deps = makeDeps({
        currentDepth: undefined,
        spawnSubagent: async (_name: string, _task: string, opts?: unknown) => {
          capturedDepth = (opts as { depth: number }).depth;
          return makeRecord();
        },
      });
      const { execute } = createSpawnAgentTool(deps);

      await execute('tu-12', { agent_name: 'test-agent', task: 'Top-level task' });
      expect(capturedDepth).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Timeout Handling
  // ---------------------------------------------------------------------------

  describe('timeout handling', () => {
    it('should return error when subagent times out', async () => {
      const deps = makeDeps({
        spawnSubagent: async () => makeRecord({
          status: 'timeout',
          result: undefined,
          timeoutMs: 60000,
        }),
      });
      const { execute } = createSpawnAgentTool(deps);

      const res = await execute('tu-13', { agent_name: 'test-agent', task: 'Slow task', timeout: 60000 });
      expect(res.isError).toBe(true);
      expect(res.content).toContain('timed out');
      expect(res.content).toContain('60000ms');
    });
  });

  // ---------------------------------------------------------------------------
  // Tool Restrictions Applied to Subagent
  // ---------------------------------------------------------------------------

  describe('tool restrictions applied to subagent', () => {
    it('should pass tool restrictions through to spawnSubagent', async () => {
      let capturedTools: string[] | undefined;
      const deps = makeDeps({
        spawnSubagent: async (_name: string, _task: string, opts?: unknown) => {
          capturedTools = (opts as { tools?: string[] }).tools;
          return makeRecord();
        },
      });
      const { execute } = createSpawnAgentTool(deps);

      await execute('tu-14', {
        agent_name: 'test-agent',
        task: 'Restricted task',
        tools: ['Read', 'Glob'],
      });
      expect(capturedTools).toEqual(['Read', 'Glob']);
    });

    it('should not pass tools when not specified', async () => {
      let capturedTools: string[] | undefined = ['should-be-cleared'];
      const deps = makeDeps({
        spawnSubagent: async (_name: string, _task: string, opts?: unknown) => {
          capturedTools = (opts as { tools?: string[] }).tools;
          return makeRecord();
        },
      });
      const { execute } = createSpawnAgentTool(deps);

      await execute('tu-15', { agent_name: 'test-agent', task: 'Open task' });
      expect(capturedTools).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Result Returned Correctly
  // ---------------------------------------------------------------------------

  describe('result returned correctly from subagent', () => {
    it('should include agent name prefix in successful result', async () => {
      const deps = makeDeps({
        spawnSubagent: async () => makeRecord({
          agentName: 'explore',
          result: 'Found 42 TypeScript files.',
        }),
      });
      const { execute } = createSpawnAgentTool(deps);

      const res = await execute('tu-16', { agent_name: 'explore', task: 'Find TS files' });
      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('[explore]');
      expect(res.content).toContain('Found 42 TypeScript files.');
    });

    it('should handle empty result from completed subagent', async () => {
      const deps = makeDeps({
        spawnSubagent: async () => makeRecord({ result: undefined }),
      });
      const { execute } = createSpawnAgentTool(deps);

      const res = await execute('tu-17', { agent_name: 'test-agent', task: 'Silent task' });
      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('no output');
    });
  });

  // ---------------------------------------------------------------------------
  // Subagent Failure Returns Error Result
  // ---------------------------------------------------------------------------

  describe('subagent failure returns error result', () => {
    it('should return error when subagent record status is failed', async () => {
      const deps = makeDeps({
        spawnSubagent: async () => makeRecord({
          status: 'failed',
          result: 'Error: Could not parse response',
        }),
      });
      const { execute } = createSpawnAgentTool(deps);

      const res = await execute('tu-18', { agent_name: 'test-agent', task: 'Failing task' });
      expect(res.isError).toBe(true);
      expect(res.content).toContain('failed');
      expect(res.content).toContain('Could not parse response');
    });

    it('should handle spawn throwing an exception', async () => {
      const deps = makeDeps({
        spawnSubagent: async () => { throw new Error('Database connection lost'); },
      });
      const { execute } = createSpawnAgentTool(deps);

      const res = await execute('tu-19', { agent_name: 'test-agent', task: 'Crash task' });
      expect(res.isError).toBe(true);
      expect(res.content).toContain('Database connection lost');
    });

    it('should handle unknown error from subagent', async () => {
      const deps = makeDeps({
        spawnSubagent: async () => makeRecord({
          status: 'failed',
          result: undefined,
        }),
      });
      const { execute } = createSpawnAgentTool(deps);

      const res = await execute('tu-20', { agent_name: 'test-agent', task: 'Broken task' });
      expect(res.isError).toBe(true);
      expect(res.content).toContain('failed');
    });
  });

  // ---------------------------------------------------------------------------
  // Input Validation
  // ---------------------------------------------------------------------------

  describe('input validation', () => {
    it('should return error when task is missing', async () => {
      const deps = makeDeps();
      const { execute } = createSpawnAgentTool(deps);

      const res = await execute('tu-21', { agent_name: 'test-agent' });
      expect(res.isError).toBe(true);
      expect(res.content).toContain('task is required');
    });

    it('should return error when task is empty string', async () => {
      const deps = makeDeps();
      const { execute } = createSpawnAgentTool(deps);

      const res = await execute('tu-22', { agent_name: 'test-agent', task: '' });
      expect(res.isError).toBe(true);
      expect(res.content).toContain('task is required');
    });

    it('should return error when task is whitespace only', async () => {
      const deps = makeDeps();
      const { execute } = createSpawnAgentTool(deps);

      const res = await execute('tu-23', { agent_name: 'test-agent', task: '   ' });
      expect(res.isError).toBe(true);
      expect(res.content).toContain('task is required');
    });
  });

  // ---------------------------------------------------------------------------
  // Parent ID Tracking
  // ---------------------------------------------------------------------------

  describe('parent ID tracking', () => {
    it('should pass parentId to spawnSubagent', async () => {
      let capturedParentId: string | undefined;
      const deps = makeDeps({
        parentId: 'parent-123',
        spawnSubagent: async (_name: string, _task: string, opts?: unknown) => {
          capturedParentId = (opts as { parentId?: string }).parentId;
          return makeRecord();
        },
      });
      const { execute } = createSpawnAgentTool(deps);

      await execute('tu-24', { agent_name: 'test-agent', task: 'Child task' });
      expect(capturedParentId).toBe('parent-123');
    });

    it('should pass undefined parentId when not set in deps', async () => {
      let capturedParentId: string | undefined = 'should-be-cleared';
      const deps = makeDeps({
        parentId: undefined,
        spawnSubagent: async (_name: string, _task: string, opts?: unknown) => {
          capturedParentId = (opts as { parentId?: string }).parentId;
          return makeRecord();
        },
      });
      const { execute } = createSpawnAgentTool(deps);

      await execute('tu-25', { agent_name: 'test-agent', task: 'Orphan task' });
      expect(capturedParentId).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Running Status Handling
  // ---------------------------------------------------------------------------

  describe('running status handling', () => {
    it('should handle still-running record gracefully', async () => {
      const deps = makeDeps({
        spawnSubagent: async () => makeRecord({ status: 'running', result: undefined }),
      });
      const { execute } = createSpawnAgentTool(deps);

      const res = await execute('tu-26', { agent_name: 'test-agent', task: 'Async task' });
      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('spawned');
      expect(res.content).toContain('running');
    });
  });
});
