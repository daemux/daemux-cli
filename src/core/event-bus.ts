/** Typed Event Bus with Pub/Sub Pattern */

import type { Message, Task, SubagentRecord } from './types';
import type { HeartbeatContext } from './heartbeat-manager';

export interface EventMap {
  // Message events
  'message:received': { message: Message; channelId: string };
  'message:sent': { message: Message; channelId: string };

  // Agent lifecycle
  'agent:start': { agentId: string; sessionId: string };
  'agent:end': { agentId: string; sessionId: string; result?: string };
  'agent:error': { agentId: string; error: Error };

  // Subagent events
  'subagent:spawn': { record: SubagentRecord };
  'subagent:complete': { record: SubagentRecord };
  'subagent:timeout': { record: SubagentRecord };
  'subagent:stream': {
    subagentId: string;
    chunk: string;
    type: 'text_delta' | 'tool_use' | 'tool_result';
  };

  // Task events
  'task:created': { task: Task };
  'task:updated': { task: Task; changes: string[] };
  'task:completed': { task: Task };
  'task:blocked': { task: Task; blockedBy: string[] };

  // Session events
  'session:start': { sessionId: string };
  'session:end': { sessionId: string };
  'session:compact': { sessionId: string; beforeTokens: number; afterTokens: number };

  // Tool events
  'tool:call': { name: string; input: Record<string, unknown>; toolUseId: string };
  'tool:result': { toolUseId: string; result: string; isError: boolean };

  // Hook events
  'hook:invoke': { event: string; sessionId: string; data?: Record<string, unknown> };
  'hook:result': { event: string; sessionId: string; allow: boolean; error?: string };

  // System events
  'startup': { config: Record<string, unknown> };
  'shutdown': { reason?: string };
  'error': { error: Error; context?: string };

  // Approval events
  'approval:request': { id: string; command: string };
  'approval:decision': { id: string; decision: string };
  'approval:timeout': { id: string };

  // Heartbeat events
  'heartbeat:started': { intervalMs: number };
  'heartbeat:stopped': Record<string, never>;
  'heartbeat:check': { context: HeartbeatContext };

  // Schedule events
  'schedule:started': Record<string, never>;
  'schedule:stopped': Record<string, never>;
  'schedule:triggered': { scheduleId: string; taskTemplate: { subject: string; description: string } };

  // Background task delegation events
  'bg-task:delegated': { taskId: string; chatKey: string; description: string };
  'bg-task:progress': { taskId: string; chatKey: string; text: string };
  'bg-task:completed': { taskId: string; chatKey: string; result: string; success: boolean };

  // Task verification events
  'task:verification_passed': { taskId: string; subject: string };
  'task:verification_failed': { taskId: string; subject: string; attempt: number; output: string };

  // Work loop events
  'work:started': { pollingIntervalMs: number; maxConcurrent: number };
  'work:stopped': { reason?: string };
  'work:task-dispatched': { taskId: string; subject: string };
  'work:task-completed': { taskId: string; subject: string; success: boolean; durationMs: number };
  'work:budget-exhausted': { tasksThisHour: number; limit: number };
  'work:poll': { availableTasks: number; runningTasks: number };

  // Swarm events
  'swarm:message': { swarmMessageId: string; from: string; to: string; type: string };
  'swarm:broadcast': { from: string; type: string; recipientCount: number };
  'swarm:agent-complete': { swarmId: string; agentId: string; result: string };
  'swarm:agent-fail': { swarmId: string; agentId: string; error: string };

  // Metrics events
  'metrics:agent': {
    agentName: string; tokensUsed: number; toolUses: number;
    duration: number; model: string; timestamp: number;
  };
  'metrics:swarm': {
    swarmId: string; totalTokens: number; totalToolUses: number;
    totalDuration: number; agentCount: number; timestamp: number;
    agentMetrics: Array<{
      agentName: string; tokensUsed: number; toolUses: number;
      duration: number; model: string; timestamp: number;
    }>;
  };
}

export type EventName = keyof EventMap;
export type EventPayload<E extends EventName> = EventMap[E];
export type EventHandler<E extends EventName> = (payload: EventPayload<E>) => void | Promise<void>;

interface ListenerEntry<E extends EventName> {
  handler: EventHandler<E>;
  once: boolean;
}

export class EventBus {
  private listeners: Map<EventName, ListenerEntry<EventName>[]> = new Map();
  private maxListeners: number;

  constructor(options?: { maxListeners?: number }) {
    this.maxListeners = options?.maxListeners ?? 100;
  }

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<E extends EventName>(event: E, handler: EventHandler<E>): () => void {
    return this.addListener(event, handler, false);
  }

  /** Subscribe once. Handler is removed after first invocation. */
  once<E extends EventName>(event: E, handler: EventHandler<E>): () => void {
    return this.addListener(event, handler, true);
  }

  /** Emit an event. Errors in handlers do not stop other handlers from executing. */
  async emit<E extends EventName>(event: E, payload: EventPayload<E>): Promise<void> {
    const entries = this.listeners.get(event);
    if (!entries || entries.length === 0) return;

    const snapshot = [...entries];
    let hasOnce = false;

    for (const entry of snapshot) {
      if (entry.once) hasOnce = true;
      try {
        await entry.handler(payload);
      } catch (err) {
        console.error(`EventBus: Error in handler for '${event}':`, err);
      }
    }

    // Remove once-handlers fired in this cycle; preserve handlers registered during emit
    if (hasOnce) {
      const onceFired = new Set(snapshot.filter(e => e.once));
      const remaining = entries.filter(e => !onceFired.has(e));
      if (remaining.length === 0) {
        this.listeners.delete(event);
      } else {
        this.listeners.set(event, remaining);
      }
    }
  }

  off(event: EventName): void { this.listeners.delete(event); }
  clear(): void { this.listeners.clear(); }
  listenerCount(event: EventName): number { return this.listeners.get(event)?.length ?? 0; }
  eventNames(): EventName[] { return Array.from(this.listeners.keys()); }

  private addListener<E extends EventName>(
    event: E, handler: EventHandler<E>, once: boolean,
  ): () => void {
    let entries = this.listeners.get(event);
    if (!entries) {
      entries = [];
      this.listeners.set(event, entries);
    }

    if (entries.length >= this.maxListeners) {
      console.warn(
        `EventBus: Possible memory leak. Event '${event}' has ${entries.length} listeners (max ${this.maxListeners}).`
      );
    }

    const entry: ListenerEntry<E> = { handler, once };
    entries.push(entry as ListenerEntry<EventName>);

    return () => {
      const currentEntries = this.listeners.get(event);
      if (!currentEntries) return;
      const index = currentEntries.indexOf(entry as ListenerEntry<EventName>);
      if (index !== -1) {
        currentEntries.splice(index, 1);
        if (currentEntries.length === 0) this.listeners.delete(event);
      }
    };
  }
}

let globalEventBus: EventBus | null = null;

export function createEventBus(options?: { maxListeners?: number }): EventBus {
  globalEventBus = new EventBus(options);
  return globalEventBus;
}

export function getEventBus(): EventBus {
  if (!globalEventBus) globalEventBus = new EventBus();
  return globalEventBus;
}
