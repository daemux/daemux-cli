/**
 * Mock Message Bus
 * In-memory pub/sub for swarm tests without requiring EventBus dependency.
 * Compatible with SwarmMessageBus interface.
 */

import type { SwarmMessage, SwarmMessageType } from '../../src/core/swarm/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MockMessageBus {
  registerAgent: (agentId: string) => void;
  unregisterAgent: (agentId: string) => void;
  send: (message: SwarmMessage) => void;
  broadcast: (fromId: string, content: string, type?: SwarmMessageType) => void;
  getMessages: (agentId: string) => SwarmMessage[];
  hasMessages: (agentId: string) => boolean;
  agentCount: () => number;
  clear: () => void;
  allMessages: SwarmMessage[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMockMessageBus(): MockMessageBus {
  const queues = new Map<string, SwarmMessage[]>();
  const agents = new Set<string>();
  const allMessages: SwarmMessage[] = [];
  let counter = 0;

  function generateId(): string {
    counter++;
    return `mock-msg-${counter}`;
  }

  return {
    allMessages,

    registerAgent(agentId: string): void {
      agents.add(agentId);
      if (!queues.has(agentId)) {
        queues.set(agentId, []);
      }
    },

    unregisterAgent(agentId: string): void {
      agents.delete(agentId);
      queues.delete(agentId);
    },

    send(message: SwarmMessage): void {
      if (!message.to) {
        throw new Error('MockMessageBus.send requires a recipient (message.to)');
      }
      const queue = queues.get(message.to);
      if (!queue) {
        throw new Error(`Recipient agent '${message.to}' is not registered`);
      }
      const enriched: SwarmMessage = { ...message, id: message.id || generateId() };
      queue.push(enriched);
      allMessages.push(enriched);
    },

    broadcast(fromId: string, content: string, type: SwarmMessageType = 'broadcast'): void {
      for (const agentId of agents) {
        if (agentId === fromId) continue;
        const msg: SwarmMessage = {
          id: generateId(),
          from: fromId,
          to: agentId,
          type,
          content,
          timestamp: Date.now(),
        };
        const queue = queues.get(agentId);
        if (queue) queue.push(msg);
        allMessages.push(msg);
      }
    },

    getMessages(agentId: string): SwarmMessage[] {
      const queue = queues.get(agentId);
      if (!queue || queue.length === 0) return [];
      const messages = [...queue];
      queue.length = 0;
      return messages;
    },

    hasMessages(agentId: string): boolean {
      const queue = queues.get(agentId);
      return queue !== undefined && queue.length > 0;
    },

    agentCount(): number {
      return agents.size;
    },

    clear(): void {
      queues.clear();
      agents.clear();
      allMessages.length = 0;
      counter = 0;
    },
  };
}
