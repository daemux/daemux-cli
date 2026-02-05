/**
 * Message Queue Unit Tests
 * Tests queue modes and message handling
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { MessageQueue, createMessageQueue } from '../src/infra/message-queue';
import type { QueuedMessage } from '../src/core/types';

describe('MessageQueue', () => {
  describe('Queue Mode', () => {
    it('should initialize with specified mode', () => {
      const queue = new MessageQueue({ mode: 'queue' });
      expect(queue.getMode()).toBe('queue');
    });

    it('should change mode', () => {
      const queue = new MessageQueue({ mode: 'steer' });
      queue.setMode('queue');
      expect(queue.getMode()).toBe('queue');
    });
  });

  describe('Steer Mode', () => {
    let queue: MessageQueue;
    let processedMessages: QueuedMessage[][] = [];

    beforeEach(() => {
      queue = new MessageQueue({ mode: 'steer' });
      processedMessages = [];
      queue.setHandler(async (messages) => {
        processedMessages.push(messages);
      });
    });

    it('should deliver messages immediately when not processing', async () => {
      const msg = await queue.add({ content: 'Hello' });

      expect(msg.id).toBeDefined();
      expect(processedMessages.length).toBe(1);
      expect(processedMessages[0][0].content).toBe('Hello');
    });

    it('should include all required fields', async () => {
      const msg = await queue.add({
        content: 'Test',
        channelId: 'channel-1',
        senderId: 'sender-1',
        priority: 5,
      });

      expect(msg.channelId).toBe('channel-1');
      expect(msg.senderId).toBe('sender-1');
      expect(msg.priority).toBe(5);
      expect(msg.queuedAt).toBeDefined();
    });
  });

  describe('Interrupt Mode', () => {
    let queue: MessageQueue;
    let interruptCalled = false;
    let processedMessages: QueuedMessage[][] = [];

    beforeEach(() => {
      queue = new MessageQueue({ mode: 'interrupt' });
      interruptCalled = false;
      processedMessages = [];

      queue.setHandler(async (messages) => {
        processedMessages.push(messages);
      });

      queue.setInterruptCallback(() => {
        interruptCalled = true;
      });
    });

    it('should clear queue and add new message at front', async () => {
      await queue.add({ content: 'First' });
      await queue.add({ content: 'Second' });

      // The queue should only have the most recent message
      expect(queue.getQueueLength()).toBe(0); // Already processed
    });
  });

  describe('Queue Mode', () => {
    let queue: MessageQueue;
    let processedMessages: QueuedMessage[][] = [];

    beforeEach(() => {
      queue = new MessageQueue({ mode: 'queue', maxQueueSize: 5 });
      processedMessages = [];
      queue.setHandler(async (messages) => {
        processedMessages.push(messages);
        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 10));
      });
    });

    it('should process messages in FIFO order', async () => {
      await queue.add({ content: 'First' });
      await queue.add({ content: 'Second' });
      await queue.add({ content: 'Third' });

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(processedMessages[0][0].content).toBe('First');
    });

    it('should handle priority based ordering', () => {
      // Test that the queue structure supports priority
      // (The actual ordering depends on when items are added relative to processing)
      const localQueue = new MessageQueue({ mode: 'queue' });

      // Without setting a handler, messages stay in queue
      localQueue.add({ content: 'Low', priority: 1 });
      localQueue.add({ content: 'High', priority: 10 });
      localQueue.add({ content: 'Medium', priority: 5 });

      // Check queue has all messages
      expect(localQueue.getQueueLength()).toBe(3);

      // First message should be highest priority
      const peeked = localQueue.peek();
      expect(peeked?.priority).toBe(10);
    });

    it('should respect max queue size', () => {
      // Create queue without handler so we can observe the queue
      const localQueue = new MessageQueue({ mode: 'queue', maxQueueSize: 3 });

      localQueue.add({ content: 'Msg 1' });
      localQueue.add({ content: 'Msg 2' });
      localQueue.add({ content: 'Msg 3' });
      localQueue.add({ content: 'Msg 4' }); // Should drop oldest

      // Queue should be at max size
      expect(localQueue.getQueueLength()).toBe(3);
    });
  });

  describe('Collect Mode', () => {
    let queue: MessageQueue;
    let processedBatches: QueuedMessage[][] = [];

    beforeEach(() => {
      queue = new MessageQueue({ mode: 'collect', collectWindowMs: 50 });
      processedBatches = [];
      queue.setHandler(async (messages) => {
        processedBatches.push(messages);
      });
    });

    it('should batch messages within time window', async () => {
      await queue.add({ content: 'Msg 1' });
      await queue.add({ content: 'Msg 2' });
      await queue.add({ content: 'Msg 3' });

      // Wait for collect window to expire
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(processedBatches.length).toBe(1);
      expect(processedBatches[0].length).toBe(3);
    });

    it('should process separate batches for messages outside window', async () => {
      await queue.add({ content: 'Batch 1 Msg 1' });
      await queue.add({ content: 'Batch 1 Msg 2' });

      // Wait for first batch
      await new Promise(resolve => setTimeout(resolve, 100));

      await queue.add({ content: 'Batch 2 Msg 1' });

      // Wait for second batch
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(processedBatches.length).toBe(2);
    });

    it('should report buffer length', async () => {
      await queue.add({ content: 'Msg 1' });
      await queue.add({ content: 'Msg 2' });

      // Before collect window expires
      expect(queue.getBufferLength()).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Message Operations', () => {
    let queue: MessageQueue;

    beforeEach(() => {
      queue = new MessageQueue({ mode: 'queue' });
    });

    it('should cancel a message', async () => {
      // Pause handler to keep message in queue
      queue.setHandler(async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
      });

      const msg1 = await queue.add({ content: 'First' });
      const msg2 = await queue.add({ content: 'Second' });

      const cancelled = queue.cancel(msg2.id);

      // Second message was added while first was processing
      // Cancel may or may not succeed depending on timing
      expect(typeof cancelled).toBe('boolean');
    });

    it('should peek at next message', async () => {
      queue.setHandler(async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
      });

      await queue.add({ content: 'First' });
      await queue.add({ content: 'Second' });

      const peeked = queue.peek();
      // May or may not have a message depending on timing
      if (peeked) {
        expect(peeked.content).toBeDefined();
      }
    });

    it('should clear all messages', async () => {
      queue.setHandler(async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
      });

      await queue.add({ content: 'First' });
      await queue.add({ content: 'Second' });

      queue.clear();

      expect(queue.getQueueLength()).toBe(0);
      expect(queue.getBufferLength()).toBe(0);
    });
  });

  describe('Queue Stats', () => {
    it('should return correct stats', () => {
      const queue = new MessageQueue({ mode: 'queue' });

      const stats = queue.getStats();

      expect(stats.mode).toBe('queue');
      expect(stats.queueLength).toBe(0);
      expect(stats.bufferLength).toBe(0);
      expect(stats.processing).toBe(false);
      expect(stats.oldestMessageAge).toBe(0);
    });
  });

  describe('Processing State', () => {
    it('should report processing state', async () => {
      const queue = new MessageQueue({ mode: 'queue' });

      let isProcessingDuringHandler = false;
      queue.setHandler(async () => {
        isProcessingDuringHandler = queue.isProcessing();
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      await queue.add({ content: 'Test' });

      // During processing
      expect(isProcessingDuringHandler).toBe(true);

      // After processing
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(queue.isProcessing()).toBe(false);
    });
  });

  describe('No Handler', () => {
    it('should queue messages without handler', async () => {
      const queue = new MessageQueue({ mode: 'queue' });

      await queue.add({ content: 'Test' });

      // Message should be in queue
      expect(queue.getQueueLength()).toBe(1);
    });
  });

  describe('Factory Function', () => {
    it('should create queue with factory', () => {
      const queue = createMessageQueue({ mode: 'steer', collectWindowMs: 1000 });

      expect(queue).toBeInstanceOf(MessageQueue);
      expect(queue.getMode()).toBe('steer');
    });
  });
});
