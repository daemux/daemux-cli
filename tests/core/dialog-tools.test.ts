/**
 * Dialog Tools Unit Tests
 * Tests delegate_task, list_tasks, and cancel_task tool executors.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { DIALOG_TOOLS, createDialogToolExecutors } from '../../src/core/dialog-tools';
import type { BackgroundTaskRunner, TaskInfo, SpawnResult } from '../../src/core/background-task-runner';

// ---------------------------------------------------------------------------
// Mock BackgroundTaskRunner
// ---------------------------------------------------------------------------

function createMockRunner(options?: {
  spawnResult?: SpawnResult;
  cancelResult?: boolean;
  tasks?: TaskInfo[];
}): BackgroundTaskRunner {
  const spawnResult = options?.spawnResult ?? { ok: true, taskId: 'task-abc-123' };
  const cancelResult = options?.cancelResult ?? true;
  const tasks = options?.tasks ?? [];

  return {
    spawn: (_desc: string, _chatKey: string) => spawnResult,
    cancel: (_taskId: string) => cancelResult,
    getTasksForChat: (_chatKey: string) => tasks,
    getTask: () => null,
    stopAll: () => {},
  } as unknown as BackgroundTaskRunner;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DIALOG_TOOLS', () => {
  it('should export exactly 4 tools', () => {
    expect(DIALOG_TOOLS).toHaveLength(4);
  });

  it('should include delegate_task tool', () => {
    const tool = DIALOG_TOOLS.find(t => t.name === 'delegate_task');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toEqual(['description']);
  });

  it('should include list_tasks tool', () => {
    const tool = DIALOG_TOOLS.find(t => t.name === 'list_tasks');
    expect(tool).toBeDefined();
  });

  it('should include cancel_task tool', () => {
    const tool = DIALOG_TOOLS.find(t => t.name === 'cancel_task');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toEqual(['taskId']);
  });

  it('should include create_agent tool', () => {
    const tool = DIALOG_TOOLS.find(t => t.name === 'create_agent');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toEqual(['task_description']);
  });
});

describe('createDialogToolExecutors', () => {
  const chatKey = 'telegram:12345';

  describe('delegate_task', () => {
    it('should call runner.spawn() and return taskId on success', async () => {
      let spawnedDesc = '';
      let spawnedChatKey = '';
      const runner = {
        spawn: (desc: string, key: string) => {
          spawnedDesc = desc;
          spawnedChatKey = key;
          return { ok: true, taskId: 'task-xyz' } as SpawnResult;
        },
        cancel: () => true,
        getTasksForChat: () => [],
        getTask: () => null,
        stopAll: () => {},
      } as unknown as BackgroundTaskRunner;

      const executors = createDialogToolExecutors(runner, chatKey);
      const delegate = executors.get('delegate_task')!;

      const result = await delegate('tool-1', { description: 'Do something complex' });

      expect(spawnedDesc).toBe('Do something complex');
      expect(spawnedChatKey).toBe(chatKey);
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content);
      expect(parsed.taskId).toBe('task-xyz');
      expect(parsed.message).toBe('Task started');
    });

    it('should return error when spawn fails (concurrency limit)', async () => {
      const runner = createMockRunner({
        spawnResult: { ok: false, error: 'Concurrency limit reached (3 tasks max per chat)' },
      });
      const executors = createDialogToolExecutors(runner, chatKey);
      const delegate = executors.get('delegate_task')!;

      const result = await delegate('tool-2', { description: 'Another task' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Concurrency limit');
    });

    it('should return error when description is empty', async () => {
      const runner = createMockRunner();
      const executors = createDialogToolExecutors(runner, chatKey);
      const delegate = executors.get('delegate_task')!;

      const result = await delegate('tool-3', { description: '' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('description is required');
    });

    it('should return error when description is missing', async () => {
      const runner = createMockRunner();
      const executors = createDialogToolExecutors(runner, chatKey);
      const delegate = executors.get('delegate_task')!;

      const result = await delegate('tool-4', {});

      expect(result.isError).toBe(true);
      expect(result.content).toContain('description is required');
    });

    it('should return error when description is whitespace-only', async () => {
      const runner = createMockRunner();
      const executors = createDialogToolExecutors(runner, chatKey);
      const delegate = executors.get('delegate_task')!;

      const result = await delegate('tool-5', { description: '   ' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('description is required');
    });

    it('should trim description before passing to runner', async () => {
      let receivedDesc = '';
      const runner = {
        spawn: (desc: string, _key: string) => {
          receivedDesc = desc;
          return { ok: true, taskId: 'task-trimmed' } as SpawnResult;
        },
        cancel: () => true,
        getTasksForChat: () => [],
        getTask: () => null,
        stopAll: () => {},
      } as unknown as BackgroundTaskRunner;

      const executors = createDialogToolExecutors(runner, chatKey);
      const delegate = executors.get('delegate_task')!;

      await delegate('tool-6', { description: '  Build the thing  ' });
      expect(receivedDesc).toBe('Build the thing');
    });
  });

  describe('list_tasks', () => {
    it('should return empty array when no tasks', async () => {
      const runner = createMockRunner({ tasks: [] });
      const executors = createDialogToolExecutors(runner, chatKey);
      const list = executors.get('list_tasks')!;

      const result = await list('tool-7', {});

      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content);
      expect(parsed).toEqual([]);
    });

    it('should return tasks with correct fields', async () => {
      const now = Date.now();
      const tasks: TaskInfo[] = [
        {
          id: 'task-1',
          description: 'First task',
          chatKey,
          status: 'running',
          startedAt: now - 5000,
          progress: 'Working on it...',
        },
        {
          id: 'task-2',
          description: 'Second task',
          chatKey,
          status: 'running',
          startedAt: now - 60000,
          progress: '',
        },
      ];
      const runner = createMockRunner({ tasks });
      const executors = createDialogToolExecutors(runner, chatKey);
      const list = executors.get('list_tasks')!;

      const result = await list('tool-8', {});

      const parsed = JSON.parse(result.content);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].id).toBe('task-1');
      expect(parsed[0].description).toBe('First task');
      expect(parsed[0].status).toBe('running');
      expect(parsed[0].elapsed).toMatch(/^\d+s$/);
      expect(parsed[1].id).toBe('task-2');
    });

    it('should include toolUseId in result', async () => {
      const runner = createMockRunner({ tasks: [] });
      const executors = createDialogToolExecutors(runner, chatKey);
      const list = executors.get('list_tasks')!;

      const result = await list('custom-tool-id', {});
      expect(result.toolUseId).toBe('custom-tool-id');
    });
  });

  describe('cancel_task', () => {
    it('should return success when cancel succeeds', async () => {
      const runner = createMockRunner({ cancelResult: true });
      const executors = createDialogToolExecutors(runner, chatKey);
      const cancel = executors.get('cancel_task')!;

      const result = await cancel('tool-9', { taskId: 'task-1' });

      expect(result.content).toBe('Task cancelled successfully');
      expect(result.isError).toBe(false);
    });

    it('should return failure when task not found', async () => {
      const runner = createMockRunner({ cancelResult: false });
      const executors = createDialogToolExecutors(runner, chatKey);
      const cancel = executors.get('cancel_task')!;

      const result = await cancel('tool-10', { taskId: 'nonexistent' });

      expect(result.content).toBe('Task not found or already completed');
      expect(result.isError).toBe(true);
    });

    it('should return error when taskId is empty', async () => {
      const runner = createMockRunner();
      const executors = createDialogToolExecutors(runner, chatKey);
      const cancel = executors.get('cancel_task')!;

      const result = await cancel('tool-11', { taskId: '' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('taskId is required');
    });

    it('should return error when taskId is missing', async () => {
      const runner = createMockRunner();
      const executors = createDialogToolExecutors(runner, chatKey);
      const cancel = executors.get('cancel_task')!;

      const result = await cancel('tool-12', {});

      expect(result.isError).toBe(true);
      expect(result.content).toContain('taskId is required');
    });

    it('should trim taskId before passing to runner', async () => {
      let receivedId = '';
      const runner = {
        spawn: () => ({ ok: true, taskId: 'x' }),
        cancel: (id: string) => { receivedId = id; return true; },
        getTasksForChat: () => [],
        getTask: () => null,
        stopAll: () => {},
      } as unknown as BackgroundTaskRunner;

      const executors = createDialogToolExecutors(runner, chatKey);
      const cancel = executors.get('cancel_task')!;

      await cancel('tool-13', { taskId: '  task-abc  ' });
      expect(receivedId).toBe('task-abc');
    });
  });

  describe('Executor map', () => {
    it('should contain exactly 4 executors', () => {
      const runner = createMockRunner();
      const executors = createDialogToolExecutors(runner, chatKey);
      expect(executors.size).toBe(4);
    });

    it('should have entries for all four tool names', () => {
      const runner = createMockRunner();
      const executors = createDialogToolExecutors(runner, chatKey);
      expect(executors.has('delegate_task')).toBe(true);
      expect(executors.has('list_tasks')).toBe(true);
      expect(executors.has('cancel_task')).toBe(true);
      expect(executors.has('create_agent')).toBe(true);
    });
  });

  describe('create_agent', () => {
    it('should return error when factory is not configured', async () => {
      const runner = createMockRunner();
      const executors = createDialogToolExecutors(runner, chatKey);
      const createAgent = executors.get('create_agent')!;

      const result = await createAgent('tool-ca-1', { task_description: 'Build something' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('factory not configured');
    });

    it('should return error when task_description is empty', async () => {
      const runner = createMockRunner();
      const mockFactory = { createAgent: async () => ({} as never) };
      const mockSpawn = async () => ({} as never);
      const executors = createDialogToolExecutors(runner, chatKey, {
        agentFactory: mockFactory as never,
        spawnSubagent: mockSpawn,
      });
      const createAgent = executors.get('create_agent')!;

      const result = await createAgent('tool-ca-2', { task_description: '' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('task_description is required');
    });

    it('should return error when task_description is missing', async () => {
      const runner = createMockRunner();
      const mockFactory = { createAgent: async () => ({} as never) };
      const mockSpawn = async () => ({} as never);
      const executors = createDialogToolExecutors(runner, chatKey, {
        agentFactory: mockFactory as never,
        spawnSubagent: mockSpawn,
      });
      const createAgent = executors.get('create_agent')!;

      const result = await createAgent('tool-ca-3', {});

      expect(result.isError).toBe(true);
      expect(result.content).toContain('task_description is required');
    });

    it('should create and spawn agent on success', async () => {
      const runner = createMockRunner();
      const mockAgent = {
        name: 'test-dynamic',
        description: 'Dynamic agent',
        model: 'haiku' as const,
        tools: ['Read', 'Grep'],
        color: 'blue' as const,
        systemPrompt: 'You are helpful.',
        pluginId: 'dynamic',
      };
      const mockRecord = {
        id: 'rec-dyn-1',
        agentName: 'test-dynamic',
        parentId: null,
        taskDescription: 'Do something',
        status: 'completed' as const,
        spawnedAt: Date.now(),
        timeoutMs: 300000,
        result: 'Agent completed the task.',
        completedAt: Date.now(),
      };

      const mockFactory = { createAgent: async () => mockAgent };
      const mockSpawn = async () => mockRecord;
      const executors = createDialogToolExecutors(runner, chatKey, {
        agentFactory: mockFactory as never,
        spawnSubagent: mockSpawn,
      });
      const createAgent = executors.get('create_agent')!;

      const result = await createAgent('tool-ca-4', { task_description: 'Do something dynamic' });

      expect(result.isError).toBeUndefined();
      expect(result.content).toContain('[test-dynamic]');
      expect(result.content).toContain('Agent completed the task.');
    });

    it('should handle factory error gracefully', async () => {
      const runner = createMockRunner();
      const mockFactory = {
        createAgent: async () => { throw new Error('LLM unavailable'); },
      };
      const mockSpawn = async () => ({} as never);
      const executors = createDialogToolExecutors(runner, chatKey, {
        agentFactory: mockFactory as never,
        spawnSubagent: mockSpawn,
      });
      const createAgent = executors.get('create_agent')!;

      const result = await createAgent('tool-ca-5', { task_description: 'Create something' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('LLM unavailable');
    });

    it('should format failed agent result correctly', async () => {
      const runner = createMockRunner();
      const mockAgent = {
        name: 'fail-agent',
        tools: ['Read'],
        pluginId: 'dynamic',
      };
      const mockRecord = {
        id: 'rec-fail',
        agentName: 'fail-agent',
        parentId: null,
        taskDescription: 'Do something',
        status: 'failed' as const,
        spawnedAt: Date.now(),
        timeoutMs: 300000,
        result: 'Out of memory',
      };

      const executors = createDialogToolExecutors(runner, chatKey, {
        agentFactory: { createAgent: async () => mockAgent } as never,
        spawnSubagent: async () => mockRecord,
      });
      const createAgent = executors.get('create_agent')!;

      const result = await createAgent('tool-ca-6', { task_description: 'Fail task' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('fail-agent');
      expect(result.content).toContain('Out of memory');
    });

    it('should format timed-out agent result correctly', async () => {
      const runner = createMockRunner();
      const mockAgent = {
        name: 'timeout-agent',
        tools: [],
        pluginId: 'dynamic',
      };
      const mockRecord = {
        id: 'rec-timeout',
        agentName: 'timeout-agent',
        parentId: null,
        taskDescription: 'Slow task',
        status: 'timeout' as const,
        spawnedAt: Date.now(),
        timeoutMs: 60000,
      };

      const executors = createDialogToolExecutors(runner, chatKey, {
        agentFactory: { createAgent: async () => mockAgent } as never,
        spawnSubagent: async () => mockRecord,
      });
      const createAgent = executors.get('create_agent')!;

      const result = await createAgent('tool-ca-7', { task_description: 'Slow task' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('timed out');
      expect(result.content).toContain('60000');
    });
  });
});
