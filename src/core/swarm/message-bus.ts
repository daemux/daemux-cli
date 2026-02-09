/** In-process message bus for inter-agent communication within a swarm. */

import type { EventBus } from '../event-bus';
import type { SwarmMessage, SwarmMessageType } from './types';

export class SwarmMessageBus {
  private queues: Map<string, SwarmMessage[]> = new Map();
  private eventBus: EventBus;
  private agentIds: Set<string> = new Set();
  private messageCounter = 0;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /** Register an agent so it can receive broadcast messages. */
  registerAgent(agentId: string): void {
    this.agentIds.add(agentId);
    if (!this.queues.has(agentId)) {
      this.queues.set(agentId, []);
    }
  }

  /** Unregister an agent and clear its queue. */
  unregisterAgent(agentId: string): void {
    this.agentIds.delete(agentId);
    this.queues.delete(agentId);
  }

  /** Send a message to a specific agent. */
  send(message: SwarmMessage): void {
    if (!message.to) {
      throw new Error('SwarmMessageBus.send requires a recipient (message.to)');
    }

    const queue = this.queues.get(message.to);
    if (!queue) {
      throw new Error(`Recipient agent '${message.to}' is not registered`);
    }

    const enriched = this.enrichMessage(message);
    queue.push(enriched);

    this.eventBus.emit('swarm:message', {
      swarmMessageId: enriched.id,
      from: enriched.from,
      to: enriched.to!,
      type: enriched.type,
    }).catch(() => { /* fire and forget */ });
  }

  /** Broadcast a message to all registered agents except the sender. */
  broadcast(fromId: string, content: string, type: SwarmMessageType = 'broadcast'): void {
    for (const agentId of this.agentIds) {
      if (agentId === fromId) continue;

      const message: SwarmMessage = {
        id: '',
        from: fromId,
        to: agentId,
        type,
        content,
        timestamp: Date.now(),
      };

      const enriched = this.enrichMessage(message);
      const queue = this.queues.get(agentId);
      if (queue) {
        queue.push(enriched);
      }
    }

    this.eventBus.emit('swarm:broadcast', {
      from: fromId,
      type,
      recipientCount: this.agentIds.size - 1,
    }).catch(() => { /* fire and forget */ });
  }

  /** Drain the message queue for an agent. Returns all pending messages and clears the queue. */
  getMessages(agentId: string): SwarmMessage[] {
    const queue = this.queues.get(agentId);
    if (!queue || queue.length === 0) return [];

    const messages = [...queue];
    queue.length = 0;
    return messages;
  }

  /** Check if an agent has pending messages. */
  hasMessages(agentId: string): boolean {
    const queue = this.queues.get(agentId);
    return queue !== undefined && queue.length > 0;
  }

  /** Get count of registered agents. */
  agentCount(): number {
    return this.agentIds.size;
  }

  /** Clear all queues and registered agents. */
  clear(): void {
    this.queues.clear();
    this.agentIds.clear();
    this.messageCounter = 0;
  }

  private enrichMessage(message: SwarmMessage): SwarmMessage {
    return {
      ...message,
      id: message.id || this.generateId(),
      timestamp: message.timestamp || Date.now(),
    };
  }

  private generateId(): string {
    this.messageCounter++;
    return `smsg-${Date.now()}-${this.messageCounter}`;
  }
}
