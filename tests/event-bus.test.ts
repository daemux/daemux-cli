/**
 * Event Bus Unit Tests
 * Tests pub/sub functionality and event handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { EventBus, createEventBus, getEventBus } from '../src/core/event-bus';

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  describe('Basic Functionality', () => {
    it('should subscribe and receive events', async () => {
      let received = false;
      let receivedPayload: any = null;

      eventBus.on('startup', (payload) => {
        received = true;
        receivedPayload = payload;
      });

      await eventBus.emit('startup', { config: { test: true } });

      expect(received).toBe(true);
      expect(receivedPayload).toEqual({ config: { test: true } });
    });

    it('should support multiple listeners for same event', async () => {
      let count = 0;

      eventBus.on('shutdown', () => { count++; });
      eventBus.on('shutdown', () => { count++; });
      eventBus.on('shutdown', () => { count++; });

      await eventBus.emit('shutdown', {});

      expect(count).toBe(3);
    });

    it('should support once listeners', async () => {
      let count = 0;

      eventBus.once('startup', () => { count++; });

      await eventBus.emit('startup', { config: {} });
      await eventBus.emit('startup', { config: {} });

      expect(count).toBe(1);
    });

    it('should return unsubscribe function', async () => {
      let count = 0;

      const unsubscribe = eventBus.on('shutdown', () => { count++; });

      await eventBus.emit('shutdown', {});
      expect(count).toBe(1);

      unsubscribe();

      await eventBus.emit('shutdown', {});
      expect(count).toBe(1);
    });
  });

  describe('Event Types', () => {
    it('should handle message events', async () => {
      let receivedMessage: any = null;

      eventBus.on('message:received', (payload) => {
        receivedMessage = payload;
      });

      const testPayload = {
        message: {
          uuid: 'test-uuid',
          parentUuid: null,
          role: 'user' as const,
          content: 'Hello',
          createdAt: Date.now(),
        },
        channelId: 'channel-1',
      };

      await eventBus.emit('message:received', testPayload);

      expect(receivedMessage).toEqual(testPayload);
    });

    it('should handle task events', async () => {
      const events: string[] = [];

      eventBus.on('task:created', () => events.push('created'));
      eventBus.on('task:updated', () => events.push('updated'));
      eventBus.on('task:completed', () => events.push('completed'));

      const taskPayload = {
        task: {
          id: 'task-1',
          subject: 'Test',
          description: 'Test task',
          status: 'pending' as const,
          blockedBy: [],
          blocks: [],
          metadata: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      };

      await eventBus.emit('task:created', taskPayload);
      await eventBus.emit('task:updated', { ...taskPayload, changes: ['status'] });
      await eventBus.emit('task:completed', taskPayload);

      expect(events).toEqual(['created', 'updated', 'completed']);
    });

    it('should handle tool events', async () => {
      let toolCall: any = null;
      let toolResult: any = null;

      eventBus.on('tool:call', (payload) => { toolCall = payload; });
      eventBus.on('tool:result', (payload) => { toolResult = payload; });

      await eventBus.emit('tool:call', {
        name: 'bash',
        input: { command: 'ls' },
        toolUseId: 'tool-1',
      });

      await eventBus.emit('tool:result', {
        toolUseId: 'tool-1',
        result: 'file1\nfile2',
        isError: false,
      });

      expect(toolCall).not.toBeNull();
      expect(toolCall.name).toBe('bash');
      expect(toolResult.result).toBe('file1\nfile2');
    });

    it('should handle error events', async () => {
      let errorPayload: any = null;

      eventBus.on('error', (payload) => {
        errorPayload = payload;
      });

      await eventBus.emit('error', {
        error: new Error('Test error'),
        context: 'test-context',
      });

      expect(errorPayload.error.message).toBe('Test error');
      expect(errorPayload.context).toBe('test-context');
    });
  });

  describe('Error Handling', () => {
    it('should continue executing other handlers when one throws', async () => {
      let secondHandlerCalled = false;

      eventBus.on('startup', () => {
        throw new Error('First handler error');
      });

      eventBus.on('startup', () => {
        secondHandlerCalled = true;
      });

      // Should not throw
      await eventBus.emit('startup', { config: {} });

      expect(secondHandlerCalled).toBe(true);
    });

    it('should handle async handler errors', async () => {
      let secondHandlerCalled = false;

      eventBus.on('startup', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        throw new Error('Async error');
      });

      eventBus.on('startup', () => {
        secondHandlerCalled = true;
      });

      await eventBus.emit('startup', { config: {} });

      expect(secondHandlerCalled).toBe(true);
    });
  });

  describe('Management Methods', () => {
    it('should clear all listeners for an event', async () => {
      let count = 0;

      eventBus.on('shutdown', () => { count++; });
      eventBus.on('shutdown', () => { count++; });

      eventBus.off('shutdown');

      await eventBus.emit('shutdown', {});

      expect(count).toBe(0);
    });

    it('should clear all listeners', async () => {
      let startupCount = 0;
      let shutdownCount = 0;

      eventBus.on('startup', () => { startupCount++; });
      eventBus.on('shutdown', () => { shutdownCount++; });

      eventBus.clear();

      await eventBus.emit('startup', { config: {} });
      await eventBus.emit('shutdown', {});

      expect(startupCount).toBe(0);
      expect(shutdownCount).toBe(0);
    });

    it('should report listener count', () => {
      eventBus.on('startup', () => {});
      eventBus.on('startup', () => {});
      eventBus.on('shutdown', () => {});

      expect(eventBus.listenerCount('startup')).toBe(2);
      expect(eventBus.listenerCount('shutdown')).toBe(1);
      expect(eventBus.listenerCount('error')).toBe(0);
    });

    it('should list event names with listeners', () => {
      eventBus.on('startup', () => {});
      eventBus.on('shutdown', () => {});
      eventBus.on('error', () => {});

      const names = eventBus.eventNames();

      expect(names).toContain('startup');
      expect(names).toContain('shutdown');
      expect(names).toContain('error');
    });
  });

  describe('Max Listeners Warning', () => {
    it('should warn when exceeding max listeners', () => {
      // Create event bus with low max listeners
      const bus = new EventBus({ maxListeners: 2 });

      // Add 3 listeners (should warn on the third)
      bus.on('startup', () => {});
      bus.on('startup', () => {});

      // This should trigger a warning (we're testing it doesn't throw)
      expect(() => {
        bus.on('startup', () => {});
      }).not.toThrow();
    });
  });

  describe('Global Instance', () => {
    it('should create global event bus', () => {
      const bus = createEventBus();
      expect(bus).toBeInstanceOf(EventBus);
    });

    it('should get global event bus', () => {
      const created = createEventBus();
      const retrieved = getEventBus();
      expect(retrieved).toBe(created);
    });

    it('should create default event bus if not initialized', () => {
      // Reset the global by creating a new one
      const newBus = new EventBus();
      const retrieved = getEventBus();
      expect(retrieved).toBeInstanceOf(EventBus);
    });
  });

  describe('Async Handlers', () => {
    it('should wait for async handlers to complete', async () => {
      const order: number[] = [];

      eventBus.on('startup', async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        order.push(1);
      });

      eventBus.on('startup', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        order.push(2);
      });

      await eventBus.emit('startup', { config: {} });

      // Both handlers should have completed
      expect(order).toContain(1);
      expect(order).toContain(2);
    });
  });
});
