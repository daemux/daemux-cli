/**
 * SwarmMessageBus Tests
 * Tests in-process inter-agent message delivery, broadcasting, and queue management.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { SwarmMessageBus } from '../../../src/core/swarm/message-bus';
import { EventBus } from '../../../src/core/event-bus';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createBus(): { messageBus: SwarmMessageBus; eventBus: EventBus } {
  const eventBus = new EventBus();
  const messageBus = new SwarmMessageBus(eventBus);
  return { messageBus, eventBus };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SwarmMessageBus', () => {
  let messageBus: SwarmMessageBus;
  let eventBus: EventBus;

  beforeEach(() => {
    ({ messageBus, eventBus } = createBus());
  });

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  describe('registerAgent', () => {
    it('should register an agent and create its queue', () => {
      messageBus.registerAgent('agent-1');
      expect(messageBus.agentCount()).toBe(1);
    });

    it('should not duplicate registration', () => {
      messageBus.registerAgent('agent-1');
      messageBus.registerAgent('agent-1');
      expect(messageBus.agentCount()).toBe(1);
    });

    it('should register multiple agents', () => {
      messageBus.registerAgent('agent-1');
      messageBus.registerAgent('agent-2');
      messageBus.registerAgent('agent-3');
      expect(messageBus.agentCount()).toBe(3);
    });
  });

  describe('unregisterAgent', () => {
    it('should remove an agent and its queue', () => {
      messageBus.registerAgent('agent-1');
      messageBus.unregisterAgent('agent-1');
      expect(messageBus.agentCount()).toBe(0);
    });

    it('should not fail for non-existent agents', () => {
      expect(() => messageBus.unregisterAgent('nonexistent')).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // send()
  // -----------------------------------------------------------------------

  describe('send', () => {
    it('should send a message to a specific agent', () => {
      messageBus.registerAgent('agent-1');
      messageBus.registerAgent('agent-2');

      messageBus.send({
        id: '',
        from: 'agent-1',
        to: 'agent-2',
        type: 'message',
        content: 'Hello agent-2',
        timestamp: Date.now(),
      });

      const messages = messageBus.getMessages('agent-2');
      expect(messages).toHaveLength(1);
      expect(messages[0]!.content).toBe('Hello agent-2');
      expect(messages[0]!.from).toBe('agent-1');
    });

    it('should assign an ID if not provided', () => {
      messageBus.registerAgent('agent-1');
      messageBus.registerAgent('agent-2');

      messageBus.send({
        id: '',
        from: 'agent-1',
        to: 'agent-2',
        type: 'message',
        content: 'test',
        timestamp: Date.now(),
      });

      const messages = messageBus.getMessages('agent-2');
      expect(messages[0]!.id).toBeTruthy();
      expect(messages[0]!.id.startsWith('smsg-')).toBe(true);
    });

    it('should preserve explicit ID', () => {
      messageBus.registerAgent('agent-1');
      messageBus.registerAgent('agent-2');

      messageBus.send({
        id: 'my-custom-id',
        from: 'agent-1',
        to: 'agent-2',
        type: 'message',
        content: 'test',
        timestamp: Date.now(),
      });

      const messages = messageBus.getMessages('agent-2');
      expect(messages[0]!.id).toBe('my-custom-id');
    });

    it('should throw if recipient is not set', () => {
      messageBus.registerAgent('agent-1');

      expect(() => messageBus.send({
        id: '',
        from: 'agent-1',
        type: 'message',
        content: 'test',
        timestamp: Date.now(),
      })).toThrow('requires a recipient');
    });

    it('should throw if recipient is not registered', () => {
      messageBus.registerAgent('agent-1');

      expect(() => messageBus.send({
        id: '',
        from: 'agent-1',
        to: 'unknown-agent',
        type: 'message',
        content: 'test',
        timestamp: Date.now(),
      })).toThrow('not registered');
    });

    it('should queue multiple messages for the same recipient', () => {
      messageBus.registerAgent('agent-1');
      messageBus.registerAgent('agent-2');

      for (let i = 0; i < 3; i++) {
        messageBus.send({
          id: '',
          from: 'agent-1',
          to: 'agent-2',
          type: 'message',
          content: `Message ${i}`,
          timestamp: Date.now(),
        });
      }

      const messages = messageBus.getMessages('agent-2');
      expect(messages).toHaveLength(3);
      expect(messages[0]!.content).toBe('Message 0');
      expect(messages[2]!.content).toBe('Message 2');
    });

    it('should not affect sender queue', () => {
      messageBus.registerAgent('agent-1');
      messageBus.registerAgent('agent-2');

      messageBus.send({
        id: '',
        from: 'agent-1',
        to: 'agent-2',
        type: 'message',
        content: 'Hello',
        timestamp: Date.now(),
      });

      expect(messageBus.hasMessages('agent-1')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // broadcast()
  // -----------------------------------------------------------------------

  describe('broadcast', () => {
    it('should broadcast to all agents except sender', () => {
      messageBus.registerAgent('agent-1');
      messageBus.registerAgent('agent-2');
      messageBus.registerAgent('agent-3');

      messageBus.broadcast('agent-1', 'Hello everyone');

      expect(messageBus.hasMessages('agent-1')).toBe(false);
      expect(messageBus.hasMessages('agent-2')).toBe(true);
      expect(messageBus.hasMessages('agent-3')).toBe(true);

      const msgs2 = messageBus.getMessages('agent-2');
      expect(msgs2).toHaveLength(1);
      expect(msgs2[0]!.content).toBe('Hello everyone');
      expect(msgs2[0]!.type).toBe('broadcast');
    });

    it('should handle broadcast with only one agent', () => {
      messageBus.registerAgent('agent-1');
      messageBus.broadcast('agent-1', 'Solo broadcast');
      expect(messageBus.hasMessages('agent-1')).toBe(false);
    });

    it('should handle broadcast with no agents', () => {
      expect(() => messageBus.broadcast('ghost', 'No one')).not.toThrow();
    });

    it('should support custom message type for broadcast', () => {
      messageBus.registerAgent('agent-1');
      messageBus.registerAgent('agent-2');

      messageBus.broadcast('agent-1', 'Shut down', 'shutdown_request');

      const msgs = messageBus.getMessages('agent-2');
      expect(msgs[0]!.type).toBe('shutdown_request');
    });
  });

  // -----------------------------------------------------------------------
  // getMessages() - drain queue
  // -----------------------------------------------------------------------

  describe('getMessages', () => {
    it('should return all pending messages and clear the queue', () => {
      messageBus.registerAgent('agent-1');
      messageBus.registerAgent('agent-2');

      messageBus.send({
        id: '', from: 'agent-1', to: 'agent-2',
        type: 'message', content: 'First', timestamp: Date.now(),
      });
      messageBus.send({
        id: '', from: 'agent-1', to: 'agent-2',
        type: 'message', content: 'Second', timestamp: Date.now(),
      });

      const messages = messageBus.getMessages('agent-2');
      expect(messages).toHaveLength(2);

      // Queue should be drained
      const empty = messageBus.getMessages('agent-2');
      expect(empty).toHaveLength(0);
    });

    it('should return empty array for agent with no messages', () => {
      messageBus.registerAgent('agent-1');
      expect(messageBus.getMessages('agent-1')).toEqual([]);
    });

    it('should return empty array for unknown agent', () => {
      expect(messageBus.getMessages('nonexistent')).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // hasMessages()
  // -----------------------------------------------------------------------

  describe('hasMessages', () => {
    it('should return true if agent has pending messages', () => {
      messageBus.registerAgent('agent-1');
      messageBus.registerAgent('agent-2');

      messageBus.send({
        id: '', from: 'agent-1', to: 'agent-2',
        type: 'message', content: 'test', timestamp: Date.now(),
      });

      expect(messageBus.hasMessages('agent-2')).toBe(true);
    });

    it('should return false if agent has no messages', () => {
      messageBus.registerAgent('agent-1');
      expect(messageBus.hasMessages('agent-1')).toBe(false);
    });

    it('should return false for unknown agent', () => {
      expect(messageBus.hasMessages('ghost')).toBe(false);
    });

    it('should return false after draining queue', () => {
      messageBus.registerAgent('agent-1');
      messageBus.registerAgent('agent-2');

      messageBus.send({
        id: '', from: 'agent-1', to: 'agent-2',
        type: 'message', content: 'test', timestamp: Date.now(),
      });

      messageBus.getMessages('agent-2');
      expect(messageBus.hasMessages('agent-2')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // clear()
  // -----------------------------------------------------------------------

  describe('clear', () => {
    it('should clear all queues and registrations', () => {
      messageBus.registerAgent('agent-1');
      messageBus.registerAgent('agent-2');

      messageBus.send({
        id: '', from: 'agent-1', to: 'agent-2',
        type: 'message', content: 'test', timestamp: Date.now(),
      });

      messageBus.clear();

      expect(messageBus.agentCount()).toBe(0);
      expect(messageBus.hasMessages('agent-2')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Event emission
  // -----------------------------------------------------------------------

  describe('event emission', () => {
    it('should emit swarm:message event on send', async () => {
      let emittedPayload: Record<string, unknown> | null = null;
      eventBus.on('swarm:message', (payload) => {
        emittedPayload = payload as unknown as Record<string, unknown>;
      });

      messageBus.registerAgent('agent-1');
      messageBus.registerAgent('agent-2');

      messageBus.send({
        id: '', from: 'agent-1', to: 'agent-2',
        type: 'message', content: 'test', timestamp: Date.now(),
      });

      // Give async event handler time to process
      await new Promise(r => setTimeout(r, 10));

      expect(emittedPayload).not.toBeNull();
      expect(emittedPayload!.from).toBe('agent-1');
      expect(emittedPayload!.to).toBe('agent-2');
    });

    it('should emit swarm:broadcast event on broadcast', async () => {
      let emittedPayload: Record<string, unknown> | null = null;
      eventBus.on('swarm:broadcast', (payload) => {
        emittedPayload = payload as unknown as Record<string, unknown>;
      });

      messageBus.registerAgent('agent-1');
      messageBus.registerAgent('agent-2');
      messageBus.registerAgent('agent-3');

      messageBus.broadcast('agent-1', 'Hello all');

      await new Promise(r => setTimeout(r, 10));

      expect(emittedPayload).not.toBeNull();
      expect(emittedPayload!.from).toBe('agent-1');
      expect(emittedPayload!.recipientCount).toBe(2);
    });
  });
});
