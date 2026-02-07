/**
 * Channel Router Unit Tests
 * Tests message routing, queue serialization, and audio transcription bridging.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { ChannelRouter, createChannelRouter, getChannelRouter } from '../../src/core/channel-router';
import { ChannelManager } from '../../src/core/channel-manager';
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

function createMockLoop(response = 'Hello from the agent') {
  let runCount = 0;
  return {
    run: async (message: string, config?: { sessionId?: string }) => {
      runCount++;
      return {
        response,
        sessionId: config?.sessionId ?? `session-${runCount}`,
        tokensUsed: { input: 10, output: 20 },
        toolCalls: [],
        stopReason: 'end_turn' as const,
        durationMs: 100,
        compacted: false,
      };
    },
    isRunning: () => false,
    interrupt: () => {},
    getSession: () => null,
    getRunCount: () => runCount,
  };
}

// ---------------------------------------------------------------------------
// Mock EnhancedChannel
// ---------------------------------------------------------------------------

function createMockChannel(id = 'telegram'): EnhancedChannel & {
  sentMessages: Array<{ chatId: string; text: string; options?: ChannelSendOptions }>;
  triggerMessage: (msg: RichChannelMessage) => Promise<void>;
} {
  const handlers: Record<string, Array<(...args: unknown[]) => void | Promise<void>>> = {
    message: [],
    error: [],
    connected: [],
    disconnected: [],
  };
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

    async sendMedia() {
      return 'media-1';
    },

    async downloadAttachment(fileId: string) {
      return { data: Buffer.from('audio data'), fileName: 'voice.ogg' };
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

    async triggerMessage(msg: RichChannelMessage) {
      for (const handler of (handlers['message'] ?? [])) {
        await handler(msg);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: Create a RichChannelMessage
// ---------------------------------------------------------------------------

function makeTextMessage(
  content: string,
  chatId = '12345',
  senderId = 'user-1',
): RichChannelMessage {
  return {
    id: `msg-${Date.now()}`,
    channelId: 'telegram',
    channelType: 'telegram',
    messageType: 'text',
    senderId,
    content,
    attachments: [],
    timestamp: Date.now(),
    isGroup: false,
    metadata: { chatId },
  };
}

function makeVoiceMessage(chatId = '12345', senderId = 'user-1'): RichChannelMessage {
  return {
    id: `voice-${Date.now()}`,
    channelId: 'telegram',
    channelType: 'telegram',
    messageType: 'voice',
    senderId,
    content: '',
    attachments: [
      {
        type: 'voice',
        url: 'file-id-123',
        duration: 5,
      },
    ],
    timestamp: Date.now(),
    isGroup: false,
    metadata: { chatId },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChannelRouter', () => {
  let eventBus: EventBus;
  let channelManager: ChannelManager;
  let logger: Logger;

  beforeEach(() => {
    eventBus = new EventBus();
    channelManager = new ChannelManager({ eventBus });
    logger = createMockLogger();
  });

  describe('Instantiation', () => {
    it('should create a ChannelRouter instance', () => {
      const loop = createMockLoop();
      const router = new ChannelRouter({
        loop: loop as unknown as Parameters<typeof createChannelRouter>[0]['loop'],
        channelManager,
        eventBus,
        logger,
      });

      expect(router).toBeInstanceOf(ChannelRouter);
    });

    it('should work with createChannelRouter factory', () => {
      const loop = createMockLoop();
      const router = createChannelRouter({
        loop: loop as unknown as Parameters<typeof createChannelRouter>[0]['loop'],
        channelManager,
        eventBus,
        logger,
      });

      expect(router).toBeInstanceOf(ChannelRouter);
      expect(getChannelRouter()).toBe(router);
    });
  });

  describe('Message Routing', () => {
    it('should route a text message through the loop and send response back', async () => {
      const loop = createMockLoop('Agent response');
      const channel = createMockChannel();
      channelManager.register(channel);

      const router = new ChannelRouter({
        loop: loop as unknown as Parameters<typeof createChannelRouter>[0]['loop'],
        channelManager,
        eventBus,
        logger,
      });

      router.start();

      const message = makeTextMessage('Hello agent');
      await channel.triggerMessage(message);

      // Allow async queue processing
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(channel.sentMessages.length).toBe(1);
      expect(channel.sentMessages[0]!.chatId).toBe('12345');
      expect(channel.sentMessages[0]!.text).toBe('Agent response');

      await router.stop();
    });

    it('should ignore empty text messages', async () => {
      const loop = createMockLoop();
      const channel = createMockChannel();
      channelManager.register(channel);

      const router = new ChannelRouter({
        loop: loop as unknown as Parameters<typeof createChannelRouter>[0]['loop'],
        channelManager,
        eventBus,
        logger,
      });

      router.start();

      const message = makeTextMessage('');
      await channel.triggerMessage(message);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(channel.sentMessages.length).toBe(0);

      await router.stop();
    });

    it('should serialize multiple messages through the queue', async () => {
      let callOrder: string[] = [];
      const loop = {
        run: async (message: string) => {
          callOrder.push(message);
          await new Promise(resolve => setTimeout(resolve, 20));
          return {
            response: `Reply to: ${message}`,
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
      channelManager.register(channel);

      const router = new ChannelRouter({
        loop: loop as unknown as Parameters<typeof createChannelRouter>[0]['loop'],
        channelManager,
        eventBus,
        logger,
      });

      router.start();

      // Fire two messages quickly
      await channel.triggerMessage(makeTextMessage('First'));
      await channel.triggerMessage(makeTextMessage('Second'));

      // Wait for both to process
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(callOrder).toEqual(['First', 'Second']);
      expect(channel.sentMessages.length).toBe(2);

      await router.stop();
    });
  });

  describe('Session Tracking', () => {
    it('should maintain session continuity per chat', async () => {
      let lastSessionId: string | undefined;
      const loop = {
        run: async (_msg: string, config?: { sessionId?: string }) => {
          lastSessionId = config?.sessionId;
          return {
            response: 'ok',
            sessionId: 'persistent-session',
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
      channelManager.register(channel);

      const router = new ChannelRouter({
        loop: loop as unknown as Parameters<typeof createChannelRouter>[0]['loop'],
        channelManager,
        eventBus,
        logger,
      });

      router.start();

      // First message: no existing session
      await channel.triggerMessage(makeTextMessage('Hello', '42'));
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(lastSessionId).toBeUndefined();

      // Second message from same chat: should reuse session
      await channel.triggerMessage(makeTextMessage('World', '42'));
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(lastSessionId).toBe('persistent-session');

      await router.stop();
    });
  });

  describe('Audio Transcription', () => {
    it('should transcribe voice messages when provider is configured', async () => {
      const loop = createMockLoop('Voice reply');
      const channel = createMockChannel();
      channelManager.register(channel);

      const transcriptionProvider = {
        id: 'openai',
        transcribe: async () => ({
          text: 'Transcribed audio text',
        }),
      };

      const router = new ChannelRouter({
        loop: loop as unknown as Parameters<typeof createChannelRouter>[0]['loop'],
        channelManager,
        eventBus,
        transcriptionProvider,
        logger,
      });

      router.start();

      await channel.triggerMessage(makeVoiceMessage('12345'));
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(channel.sentMessages.length).toBe(1);
      expect(channel.sentMessages[0]!.text).toBe('Voice reply');

      await router.stop();
    });

    it('should send error message when audio transcription fails without text', async () => {
      const loop = createMockLoop();
      const channel = createMockChannel();
      channelManager.register(channel);

      const router = new ChannelRouter({
        loop: loop as unknown as Parameters<typeof createChannelRouter>[0]['loop'],
        channelManager,
        eventBus,
        logger,
      });

      router.start();

      await channel.triggerMessage(makeVoiceMessage('12345'));
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should send the "could not transcribe" message
      expect(channel.sentMessages.length).toBe(1);
      expect(channel.sentMessages[0]!.text).toContain('could not transcribe');

      await router.stop();
    });
  });

  describe('Stop/Cleanup', () => {
    it('should stop processing and clear queue', async () => {
      const loop = createMockLoop();
      const channel = createMockChannel();
      channelManager.register(channel);

      const router = new ChannelRouter({
        loop: loop as unknown as Parameters<typeof createChannelRouter>[0]['loop'],
        channelManager,
        eventBus,
        logger,
      });

      router.start();
      await router.stop();

      // After stop, messages should not be processed
      await channel.triggerMessage(makeTextMessage('After stop'));
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(channel.sentMessages.length).toBe(0);
    });
  });
});
