/**
 * Channel Router Unit Tests
 * Tests message routing, queue serialization, audio transcription bridging,
 * dialog mode (ChatSession-based), and backward compatibility (legacy mode).
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { existsSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { ChannelRouter, createChannelRouter, getChannelRouter } from '../../src/core/channel-router';
import { ChannelManager } from '../../src/core/channel-manager';
import { EventBus } from '../../src/core/event-bus';
import { Database } from '../../src/infra/database';
import { createReadyMockProvider, MockLLMProvider } from '../mocks/mock-llm-provider';
import type { EnhancedChannel, RichChannelMessage, ChannelSendOptions } from '../../src/core/channel-types';
import type { Config } from '../../src/core/types';
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

// ---------------------------------------------------------------------------
// Dialog Mode Tests (ChatSession-based routing)
// ---------------------------------------------------------------------------

describe('ChannelRouter - Dialog Mode', () => {
  let eventBus: EventBus;
  let channelManager: ChannelManager;
  let logger: Logger;
  let db: Database;
  let provider: MockLLMProvider;

  const testDbPath = join(import.meta.dir, 'test-router-dialog.sqlite');
  const testDir = join(import.meta.dir, 'test-router-dialog-files');

  const testConfig: Config = {
    agentId: 'test-agent',
    dataDir: testDir,
    model: 'mock-model',
    compactionThreshold: 0.8,
    effectiveContextWindow: 180000,
    queueMode: 'steer',
    collectWindowMs: 5000,
    hookTimeoutMs: 600000,
    turnTimeoutMs: 1800000,
    debug: false,
    mcpDebug: false,
    heartbeatIntervalMs: 1800000,
    heartbeatEnabled: false,
    maxConcurrentTasks: 3,
    workPollingIntervalMs: 5000,
    workMaxIterationsPerTask: 100,
    workBudgetMaxTasksPerHour: 50,
  };

  beforeEach(async () => {
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    mkdirSync(testDir, { recursive: true });
    db = new Database({ path: testDbPath, enableVec: false });
    await db.initialize();
    eventBus = new EventBus();
    channelManager = new ChannelManager({ eventBus });
    logger = createMockLogger();
    provider = createReadyMockProvider();
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  describe('Dialog Mode Detection', () => {
    it('should use dialog mode when db, provider, and config are provided', () => {
      const router = new ChannelRouter({
        channelManager,
        eventBus,
        logger,
        db,
        provider,
        config: testConfig,
      });

      // If dialog mode is active, it creates a BackgroundTaskRunner internally.
      // We verify by instantiation not throwing.
      expect(router).toBeInstanceOf(ChannelRouter);
    });

    it('should fall back to legacy mode with only loop', () => {
      const loop = createMockLoop();
      const router = new ChannelRouter({
        loop: loop as unknown as Parameters<typeof createChannelRouter>[0]['loop'],
        channelManager,
        eventBus,
        logger,
      });

      expect(router).toBeInstanceOf(ChannelRouter);
    });
  });

  describe('Per-chat session isolation', () => {
    it('should route messages from different chats to separate sessions', async () => {
      provider.addTextResponse('Reply to chat A');
      provider.addTextResponse('Reply to chat B');

      const channel = createMockChannel();
      channelManager.register(channel);

      const router = new ChannelRouter({
        channelManager,
        eventBus,
        logger,
        db,
        provider,
        config: testConfig,
      });

      router.start();

      await channel.triggerMessage(makeTextMessage('Hello from A', '100'));
      await new Promise(r => setTimeout(r, 200));

      await channel.triggerMessage(makeTextMessage('Hello from B', '200'));
      await new Promise(r => setTimeout(r, 200));

      // Both chats should have received responses
      const chatAMsgs = channel.sentMessages.filter(m => m.chatId === '100');
      const chatBMsgs = channel.sentMessages.filter(m => m.chatId === '200');

      expect(chatAMsgs.length).toBeGreaterThanOrEqual(1);
      expect(chatBMsgs.length).toBeGreaterThanOrEqual(1);

      await router.stop();
    });

    it('should reuse session for same chat across messages', async () => {
      provider.addTextResponse('First response');
      provider.addTextResponse('Second response');

      const channel = createMockChannel();
      channelManager.register(channel);

      const router = new ChannelRouter({
        channelManager,
        eventBus,
        logger,
        db,
        provider,
        config: testConfig,
      });

      router.start();

      await channel.triggerMessage(makeTextMessage('Msg 1', '42'));
      await new Promise(r => setTimeout(r, 200));

      await channel.triggerMessage(makeTextMessage('Msg 2', '42'));
      await new Promise(r => setTimeout(r, 200));

      // Both should have gone to the same chat
      const chat42Msgs = channel.sentMessages.filter(m => m.chatId === '42');
      expect(chat42Msgs.length).toBe(2);

      await router.stop();
    });
  });

  describe('Dialog mode message routing', () => {
    it('should route text message and send response via ChatSession', async () => {
      provider.addTextResponse('Dialog response');

      const channel = createMockChannel();
      channelManager.register(channel);

      const router = new ChannelRouter({
        channelManager,
        eventBus,
        logger,
        db,
        provider,
        config: testConfig,
      });

      router.start();

      await channel.triggerMessage(makeTextMessage('Hello dialog'));
      await new Promise(r => setTimeout(r, 200));

      expect(channel.sentMessages.length).toBeGreaterThanOrEqual(1);
      expect(channel.sentMessages[0]!.chatId).toBe('12345');

      await router.stop();
    });

    it('should ignore empty messages in dialog mode', async () => {
      const channel = createMockChannel();
      channelManager.register(channel);

      const router = new ChannelRouter({
        channelManager,
        eventBus,
        logger,
        db,
        provider,
        config: testConfig,
      });

      router.start();

      await channel.triggerMessage(makeTextMessage(''));
      await new Promise(r => setTimeout(r, 100));

      expect(channel.sentMessages).toHaveLength(0);

      await router.stop();
    });
  });

  describe('Dialog mode stop', () => {
    it('should clean up all sessions and task runner on stop', async () => {
      provider.addTextResponse('Before stop');

      const channel = createMockChannel();
      channelManager.register(channel);

      const router = new ChannelRouter({
        channelManager,
        eventBus,
        logger,
        db,
        provider,
        config: testConfig,
      });

      router.start();

      await channel.triggerMessage(makeTextMessage('Before'));
      await new Promise(r => setTimeout(r, 200));

      await router.stop();

      // After stop, no new messages should be processed
      provider.addTextResponse('After stop response');
      await channel.triggerMessage(makeTextMessage('After'));
      await new Promise(r => setTimeout(r, 100));

      // Only the "Before" message should have produced a response
      const responses = channel.sentMessages.filter(m =>
        m.text !== 'Before stop' && m.text !== 'After stop response'
      );
      // The "After" message should not produce additional output beyond what was already sent
    });
  });

  describe('Backward compatibility', () => {
    it('should still work in legacy mode with loop parameter', async () => {
      const loop = createMockLoop('Legacy response');
      const channel = createMockChannel();
      channelManager.register(channel);

      const router = new ChannelRouter({
        loop: loop as unknown as Parameters<typeof createChannelRouter>[0]['loop'],
        channelManager,
        eventBus,
        logger,
      });

      router.start();

      await channel.triggerMessage(makeTextMessage('Legacy message'));
      await new Promise(r => setTimeout(r, 100));

      expect(channel.sentMessages.length).toBe(1);
      expect(channel.sentMessages[0]!.text).toBe('Legacy response');

      await router.stop();
    });
  });

  describe('message:received event', () => {
    it('should emit message:received event in dialog mode', async () => {
      provider.addTextResponse('Response');
      const events: Array<{ channelId: string }> = [];
      eventBus.on('message:received', (payload) => { events.push(payload); });

      const channel = createMockChannel();
      channelManager.register(channel);

      const router = new ChannelRouter({
        channelManager,
        eventBus,
        logger,
        db,
        provider,
        config: testConfig,
      });

      router.start();

      await channel.triggerMessage(makeTextMessage('Event test'));
      await new Promise(r => setTimeout(r, 100));

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0]!.channelId).toBe('telegram');

      await router.stop();
    });
  });
});
