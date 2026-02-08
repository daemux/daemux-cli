/**
 * Legacy Channel Handler Unit Tests
 * Tests queue-based message processing for backward-compatible loop mode.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { LegacyChannelHandler } from '../../src/core/legacy-channel-handler';
import type { LegacyQueueItem } from '../../src/core/legacy-channel-handler';
import { EventBus } from '../../src/core/event-bus';
import type { EnhancedChannel, RichChannelMessage, ChannelSendOptions } from '../../src/core/channel-types';
import type { Logger } from '../../src/infra/logger';

// ---------------------------------------------------------------------------
// Mock Logger
// ---------------------------------------------------------------------------

function createMockLogger(): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    log: () => {},
    child: () => createMockLogger(),
    close: async () => {},
    getLogFile: () => null,
    getSessionId: () => 'test-session',
    initialize: async () => {},
  } as unknown as Logger;
}

// ---------------------------------------------------------------------------
// Mock AgenticLoop
// ---------------------------------------------------------------------------

function createMockLoop(opts?: {
  response?: string;
  delay?: number;
  throwError?: string;
}) {
  let sessionCount = 0;
  const callLog: Array<{ message: string; sessionId?: string }> = [];

  return {
    run: async (message: string, config?: { sessionId?: string }) => {
      callLog.push({ message, sessionId: config?.sessionId });
      if (opts?.delay) await new Promise(r => setTimeout(r, opts.delay));
      if (opts?.throwError) throw new Error(opts.throwError);
      sessionCount++;
      return {
        response: opts?.response ?? 'Mock response',
        sessionId: config?.sessionId ?? `session-${sessionCount}`,
        tokensUsed: { input: 10, output: 20 },
        toolCalls: [],
        stopReason: 'end_turn' as const,
        durationMs: 100,
        compacted: false,
      };
    },
    isRunning: () => false,
    interrupt: () => {},
    callLog,
  };
}

// ---------------------------------------------------------------------------
// Mock Channel
// ---------------------------------------------------------------------------

function createMockChannel(id = 'telegram'): EnhancedChannel & {
  sentMessages: Array<{ chatId: string; text: string; options?: ChannelSendOptions }>;
} {
  const handlers: Record<string, Array<(...args: unknown[]) => void | Promise<void>>> = {};
  const sentMessages: Array<{ chatId: string; text: string; options?: ChannelSendOptions }> = [];

  return {
    id,
    type: 'telegram',
    connected: true,
    async connect() {},
    async disconnect() {},
    async sendText(chatId: string, text: string, options?: ChannelSendOptions): Promise<string> {
      sentMessages.push({ chatId, text, options });
      return `msg-${sentMessages.length}`;
    },
    async sendMedia() { return 'media-1'; },
    async downloadAttachment() {
      return { data: Buffer.from('data'), fileName: 'file.bin' };
    },
    on(event: string, handler: (...args: unknown[]) => void | Promise<void>): () => void {
      if (!handlers[event]) handlers[event] = [];
      handlers[event]!.push(handler);
      return () => {
        const list = handlers[event];
        if (list) {
          const idx = list.indexOf(handler);
          if (idx !== -1) list.splice(idx, 1);
        }
      };
    },
    sentMessages,
  };
}

// ---------------------------------------------------------------------------
// Helper: Create a RichChannelMessage
// ---------------------------------------------------------------------------

function makeMessage(content: string, chatId = '12345'): RichChannelMessage {
  return {
    id: `msg-${Date.now()}-${Math.random()}`,
    channelId: 'telegram',
    channelType: 'telegram',
    messageType: 'text',
    senderId: 'user-1',
    content,
    attachments: [],
    timestamp: Date.now(),
    isGroup: false,
    metadata: { chatId },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LegacyChannelHandler', () => {
  let eventBus: EventBus;
  let logger: Logger;

  beforeEach(() => {
    eventBus = new EventBus();
    logger = createMockLogger();
  });

  function createHandler(loop: ReturnType<typeof createMockLoop>): LegacyChannelHandler {
    return new LegacyChannelHandler({
      loop: loop as unknown as Parameters<typeof LegacyChannelHandler['prototype']['enqueue']> extends never[]
        ? never
        : ConstructorParameters<typeof LegacyChannelHandler>[0]['loop'],
      eventBus,
      logger,
      resolveChatId: (msg) => {
        const meta = msg.metadata as Record<string, unknown>;
        return String(meta['chatId'] ?? msg.senderId);
      },
    });
  }

  describe('enqueue and process', () => {
    it('should process an enqueued message and send response', async () => {
      const loop = createMockLoop({ response: 'Bot reply' });
      const channel = createMockChannel();
      const handler = createHandler(loop);

      handler.enqueue({
        message: makeMessage('Hello'),
        channel,
        text: 'Hello',
      });

      await new Promise(r => setTimeout(r, 100));

      expect(channel.sentMessages).toHaveLength(1);
      expect(channel.sentMessages[0]!.text).toBe('Bot reply');
      expect(channel.sentMessages[0]!.chatId).toBe('12345');

      handler.stop();
    });

    it('should send response with markdown parseMode', async () => {
      const loop = createMockLoop({ response: '**Bold**' });
      const channel = createMockChannel();
      const handler = createHandler(loop);

      handler.enqueue({ message: makeMessage('Test'), channel, text: 'Test' });
      await new Promise(r => setTimeout(r, 100));

      expect(channel.sentMessages[0]!.options?.parseMode).toBe('markdown');

      handler.stop();
    });

    it('should send response as reply to original message', async () => {
      const loop = createMockLoop({ response: 'Reply' });
      const channel = createMockChannel();
      const handler = createHandler(loop);
      const msg = makeMessage('Question');

      handler.enqueue({ message: msg, channel, text: 'Question' });
      await new Promise(r => setTimeout(r, 100));

      expect(channel.sentMessages[0]!.options?.replyToId).toBe(msg.id);

      handler.stop();
    });

    it('should not send response when loop returns empty', async () => {
      const loop = createMockLoop({ response: '' });
      const channel = createMockChannel();
      const handler = createHandler(loop);

      handler.enqueue({ message: makeMessage('Empty'), channel, text: 'Empty' });
      await new Promise(r => setTimeout(r, 100));

      expect(channel.sentMessages).toHaveLength(0);

      handler.stop();
    });

    it('should not send response when loop returns whitespace', async () => {
      const loop = createMockLoop({ response: '   ' });
      const channel = createMockChannel();
      const handler = createHandler(loop);

      handler.enqueue({ message: makeMessage('Blank'), channel, text: 'Blank' });
      await new Promise(r => setTimeout(r, 100));

      expect(channel.sentMessages).toHaveLength(0);

      handler.stop();
    });
  });

  describe('Queue serialization', () => {
    it('should process messages sequentially', async () => {
      const callOrder: string[] = [];
      const loop = {
        run: async (message: string) => {
          callOrder.push(message);
          await new Promise(r => setTimeout(r, 30));
          return {
            response: `Reply: ${message}`,
            sessionId: 'test-session',
            tokensUsed: { input: 10, output: 20 },
            toolCalls: [],
            stopReason: 'end_turn' as const,
            durationMs: 100,
            compacted: false,
          };
        },
        isRunning: () => false,
        interrupt: () => {},
      };

      const channel = createMockChannel();
      const handler = new LegacyChannelHandler({
        loop: loop as unknown as ConstructorParameters<typeof LegacyChannelHandler>[0]['loop'],
        eventBus,
        logger,
        resolveChatId: (msg) => {
          const meta = msg.metadata as Record<string, unknown>;
          return String(meta['chatId'] ?? msg.senderId);
        },
      });

      handler.enqueue({ message: makeMessage('First'), channel, text: 'First' });
      handler.enqueue({ message: makeMessage('Second'), channel, text: 'Second' });
      handler.enqueue({ message: makeMessage('Third'), channel, text: 'Third' });

      await new Promise(r => setTimeout(r, 300));

      expect(callOrder).toEqual(['First', 'Second', 'Third']);
      expect(channel.sentMessages).toHaveLength(3);

      handler.stop();
    });
  });

  describe('Session ID tracking', () => {
    it('should maintain session continuity for same channel+chat', async () => {
      const loop = createMockLoop({ response: 'ok' });
      const channel = createMockChannel();
      const handler = createHandler(loop);

      handler.enqueue({ message: makeMessage('First', '42'), channel, text: 'First' });
      await new Promise(r => setTimeout(r, 100));

      handler.enqueue({ message: makeMessage('Second', '42'), channel, text: 'Second' });
      await new Promise(r => setTimeout(r, 100));

      // First call should have no sessionId, second should reuse
      expect(loop.callLog).toHaveLength(2);
      expect(loop.callLog[0]!.sessionId).toBeUndefined();
      expect(loop.callLog[1]!.sessionId).toBe('session-1');

      handler.stop();
    });

    it('should maintain separate sessions for different chats', async () => {
      const loop = createMockLoop({ response: 'ok' });
      const channel = createMockChannel();
      const handler = createHandler(loop);

      handler.enqueue({ message: makeMessage('Chat A', '100'), channel, text: 'Chat A' });
      await new Promise(r => setTimeout(r, 100));

      handler.enqueue({ message: makeMessage('Chat B', '200'), channel, text: 'Chat B' });
      await new Promise(r => setTimeout(r, 100));

      // Both calls should have no sessionId (different chats, first message each)
      expect(loop.callLog).toHaveLength(2);
      expect(loop.callLog[0]!.sessionId).toBeUndefined();
      expect(loop.callLog[1]!.sessionId).toBeUndefined();

      handler.stop();
    });
  });

  describe('Error handling', () => {
    it('should send user-friendly error when loop throws', async () => {
      const loop = createMockLoop({ throwError: 'Connection refused' });
      const channel = createMockChannel();
      const handler = createHandler(loop);

      handler.enqueue({ message: makeMessage('Fail'), channel, text: 'Fail' });
      await new Promise(r => setTimeout(r, 100));

      expect(channel.sentMessages).toHaveLength(1);
      // Should get classified error message (default for unknown errors)
      expect(channel.sentMessages[0]!.text).toBe('An error occurred while processing your message.');

      handler.stop();
    });

    it('should send credential error for credential-related errors', async () => {
      const loop = createMockLoop({ throwError: 'Invalid credential provided' });
      const channel = createMockChannel();
      const handler = createHandler(loop);

      handler.enqueue({ message: makeMessage('Auth fail'), channel, text: 'Auth fail' });
      await new Promise(r => setTimeout(r, 100));

      expect(channel.sentMessages[0]!.text).toBe('Bot API credentials are not configured correctly.');

      handler.stop();
    });

    it('should continue processing after error', async () => {
      let callCount = 0;
      const loop = {
        run: async (message: string) => {
          callCount++;
          if (callCount === 1) throw new Error('Temporary failure');
          return {
            response: 'Recovery success',
            sessionId: 'session-1',
            tokensUsed: { input: 10, output: 20 },
            toolCalls: [],
            stopReason: 'end_turn' as const,
            durationMs: 100,
            compacted: false,
          };
        },
        isRunning: () => false,
        interrupt: () => {},
      };

      const channel = createMockChannel();
      const handler = new LegacyChannelHandler({
        loop: loop as unknown as ConstructorParameters<typeof LegacyChannelHandler>[0]['loop'],
        eventBus,
        logger,
        resolveChatId: (msg) => {
          const meta = msg.metadata as Record<string, unknown>;
          return String(meta['chatId'] ?? msg.senderId);
        },
      });

      handler.enqueue({ message: makeMessage('Fail'), channel, text: 'Fail' });
      handler.enqueue({ message: makeMessage('Succeed'), channel, text: 'Succeed' });
      await new Promise(r => setTimeout(r, 200));

      // First message: error response, second message: success response
      expect(channel.sentMessages.length).toBe(2);
      expect(channel.sentMessages[1]!.text).toBe('Recovery success');

      handler.stop();
    });
  });

  describe('emit message:sent event', () => {
    it('should emit message:sent event for responses', async () => {
      const loop = createMockLoop({ response: 'Event test' });
      const channel = createMockChannel();
      const handler = createHandler(loop);
      const events: Array<{ channelId: string }> = [];
      eventBus.on('message:sent', (payload) => { events.push(payload); });

      handler.enqueue({ message: makeMessage('Test'), channel, text: 'Test' });
      await new Promise(r => setTimeout(r, 100));

      expect(events).toHaveLength(1);
      expect(events[0]!.channelId).toBe('telegram');

      handler.stop();
    });
  });

  describe('clearQueue()', () => {
    it('should clear pending messages', async () => {
      const loop = createMockLoop({ response: 'ok', delay: 200 });
      const channel = createMockChannel();
      const handler = createHandler(loop);

      // Enqueue messages
      handler.enqueue({ message: makeMessage('First'), channel, text: 'First' });
      handler.enqueue({ message: makeMessage('Second'), channel, text: 'Second' });
      handler.enqueue({ message: makeMessage('Third'), channel, text: 'Third' });

      // Clear while first is processing
      handler.clearQueue();
      await new Promise(r => setTimeout(r, 400));

      // Only the first (already processing) message should have been handled
      expect(channel.sentMessages.length).toBeLessThanOrEqual(1);

      handler.stop();
    });
  });

  describe('stop()', () => {
    it('should stop processing and clear queue', async () => {
      const loop = createMockLoop({ response: 'ok', delay: 100 });
      const channel = createMockChannel();
      const handler = createHandler(loop);

      handler.enqueue({ message: makeMessage('Before stop'), channel, text: 'Before stop' });
      handler.stop();
      handler.enqueue({ message: makeMessage('After stop'), channel, text: 'After stop' });

      await new Promise(r => setTimeout(r, 200));

      // Messages after stop should not be processed
      const afterStopMsg = channel.sentMessages.find(m => m.text === 'Reply: After stop');
      expect(afterStopMsg).toBeUndefined();
    });
  });
});
