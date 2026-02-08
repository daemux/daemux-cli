/**
 * Dialog Tools
 * Tools available to the lightweight dialog loop for task delegation.
 * The dialog loop uses these to spawn background tasks, list them, and cancel them.
 */

import type { ToolDefinition, ToolResult } from './types';
import type { BackgroundTaskRunner } from './background-task-runner';

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

const delegateTaskTool: ToolDefinition = {
  name: 'delegate_task',
  description:
    'Delegate a complex task to a background worker. The worker has full tool access ' +
    '(file read/write, bash). Use this for tasks that require multiple steps or tool usage.',
  inputSchema: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: 'A clear description of the task to perform',
      },
    },
    required: ['description'],
  },
};

const listTasksTool: ToolDefinition = {
  name: 'list_tasks',
  description: 'List all active background tasks for this chat.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

const cancelTaskTool: ToolDefinition = {
  name: 'cancel_task',
  description: 'Cancel a running background task by its ID.',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'The ID of the task to cancel',
      },
    },
    required: ['taskId'],
  },
};

export const DIALOG_TOOLS: ToolDefinition[] = [
  delegateTaskTool,
  listTasksTool,
  cancelTaskTool,
];

// ---------------------------------------------------------------------------
// Tool Executor Factory
// ---------------------------------------------------------------------------

export type DialogToolExecutor = (
  toolUseId: string,
  input: Record<string, unknown>,
) => Promise<ToolResult>;

export function createDialogToolExecutors(
  runner: BackgroundTaskRunner,
  chatKey: string,
): Map<string, DialogToolExecutor> {
  const executors = new Map<string, DialogToolExecutor>();

  executors.set('delegate_task', async (toolUseId, input) => {
    const description = input.description as string;
    if (!description?.trim()) {
      return { toolUseId, content: 'Error: description is required', isError: true };
    }
    const result = runner.spawn(description.trim(), chatKey);
    if (!result.ok) {
      return { toolUseId, content: `Error: ${result.error}`, isError: true };
    }
    return { toolUseId, content: JSON.stringify({ taskId: result.taskId, message: 'Task started' }) };
  });

  executors.set('list_tasks', async (toolUseId) => {
    const tasks = runner.getTasksForChat(chatKey);
    const list = tasks.map(t => ({
      id: t.id,
      description: t.description,
      status: t.status,
      elapsed: `${Math.round((Date.now() - t.startedAt) / 1000)}s`,
    }));
    return { toolUseId, content: JSON.stringify(list) };
  });

  executors.set('cancel_task', async (toolUseId, input) => {
    const taskId = input.taskId as string;
    if (!taskId?.trim()) {
      return { toolUseId, content: 'Error: taskId is required', isError: true };
    }
    const cancelled = runner.cancel(taskId.trim());
    const msg = cancelled ? 'Task cancelled successfully' : 'Task not found or already completed';
    return { toolUseId, content: msg, isError: !cancelled };
  });

  return executors;
}
