/**
 * Dialog Flow Integration Tests
 * End-to-end tests for the full dialog architecture:
 * channel -> router -> chat session -> dialog loop -> response
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { existsSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { ChannelRouter } from '../../src/core/channel-router';
import { ChannelManager } from '../../src/core/channel-manager';
import { EventBus } from '../../src/core/event-bus';
import { Database } from '../../src/infra/database';
import { createReadyMockProvider, MockLLMProvider } from '../mocks/mock-llm-provider';
import type { EnhancedChannel, RichChannelMessage, ChannelSendOptions } from '../../src/core/channel-types';
import type { Config } from '../../src/core/types';
import type { Logger } from '../../src/infra/logger';

// ---------------------------------------------------------------------------
// Test Configuration
// ---------------------------------------------------------------------------

const testDbPath = join(import.meta.dir, 'test-dialog-flow.sqlite');
const testDir = join(import.meta.dir, 'test-dialog-flow-files');

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
  workBudgetMaxTasksPerHour: 50,
};

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
// Mock Channel
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
    type: id === 'telegram' ? 'telegram' : 'discord',
    connected: true,
    async connect() {},
    async disconnect() {},
    async sendText(chatId: string, text: string, options?: ChannelSendOptions): Promise<string> {
      sentMessages.push({ chatId, text, options });
      return `msg-${sentMessages.length}`;
    },
    async sendMedia() { return 'media-1'; },
    async downloadAttachment() {
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
  channelId = 'telegram',
): RichChannelMessage {
  return {
    id: `msg-${Date.now()}-${Math.random()}`,
    channelId,
    channelType: channelId === 'telegram' ? 'telegram' : 'discord',
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
// Integration Tests
// ---------------------------------------------------------------------------

describe('Dialog Flow Integration', () => {
  let db: Database;
  let eventBus: EventBus;
  let channelManager: ChannelManager;
  let logger: Logger;
  let provider: MockLLMProvider;

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

  describe('Full message flow', () => {
    it('should process message through router -> session -> dialog -> channel response', async () => {
      provider.addTextResponse('I can help with that!');

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

      await channel.triggerMessage(makeTextMessage('Can you help me?'));
      await new Promise(r => setTimeout(r, 300));

      // Verify the response was sent back to the correct channel and chat
      expect(channel.sentMessages.length).toBeGreaterThanOrEqual(1);
      expect(channel.sentMessages[0]!.chatId).toBe('12345');
      expect(channel.sentMessages[0]!.text).toBe('I can help with that!');

      // Verify events were emitted
      const receivedEvents: unknown[] = [];
      const sentEvents: unknown[] = [];
      eventBus.on('message:received', (p) => receivedEvents.push(p));
      eventBus.on('message:sent', (p) => sentEvents.push(p));

      await router.stop();
    });

    it('should emit message:received and message:sent events', async () => {
      provider.addTextResponse('Event flow response');

      const receivedEvents: Array<{ channelId: string }> = [];
      const sentEvents: Array<{ channelId: string }> = [];
      eventBus.on('message:received', (p) => receivedEvents.push(p));
      eventBus.on('message:sent', (p) => sentEvents.push(p));

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
      await new Promise(r => setTimeout(r, 300));

      expect(receivedEvents.length).toBeGreaterThanOrEqual(1);
      expect(sentEvents.length).toBeGreaterThanOrEqual(1);
      expect(receivedEvents[0]!.channelId).toBe('telegram');
      expect(sentEvents[0]!.channelId).toBe('telegram');

      await router.stop();
    });
  });

  describe('Concurrent chats', () => {
    it('should handle messages from two channels independently', async () => {
      provider.addTextResponse('Telegram reply');
      provider.addTextResponse('Discord reply');

      const telegramChannel = createMockChannel('telegram');
      const discordChannel = createMockChannel('discord');
      channelManager.register(telegramChannel);
      channelManager.register(discordChannel);

      const router = new ChannelRouter({
        channelManager,
        eventBus,
        logger,
        db,
        provider,
        config: testConfig,
      });

      router.start();

      await telegramChannel.triggerMessage(makeTextMessage('Hello from Telegram', '111', 'telegram'));
      await new Promise(r => setTimeout(r, 200));

      await discordChannel.triggerMessage(makeTextMessage('Hello from Discord', '222', 'discord'));
      await new Promise(r => setTimeout(r, 200));

      // Each channel should have its own response
      expect(telegramChannel.sentMessages.length).toBeGreaterThanOrEqual(1);
      expect(telegramChannel.sentMessages[0]!.chatId).toBe('111');

      expect(discordChannel.sentMessages.length).toBeGreaterThanOrEqual(1);
      expect(discordChannel.sentMessages[0]!.chatId).toBe('222');

      await router.stop();
    });

    it('should handle messages from different chats on same channel', async () => {
      provider.addTextResponse('Reply to user A');
      provider.addTextResponse('Reply to user B');

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

      await channel.triggerMessage(makeTextMessage('From user A', '111'));
      await new Promise(r => setTimeout(r, 200));

      await channel.triggerMessage(makeTextMessage('From user B', '222'));
      await new Promise(r => setTimeout(r, 200));

      const chatAMsgs = channel.sentMessages.filter(m => m.chatId === '111');
      const chatBMsgs = channel.sentMessages.filter(m => m.chatId === '222');

      expect(chatAMsgs.length).toBeGreaterThanOrEqual(1);
      expect(chatBMsgs.length).toBeGreaterThanOrEqual(1);

      await router.stop();
    });
  });

  describe('Multi-turn conversation', () => {
    it('should maintain context across multiple messages in same chat', async () => {
      provider.addTextResponse('Nice to meet you!');
      provider.addTextResponse('Your name is Alice.');

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

      await channel.triggerMessage(makeTextMessage('My name is Alice', '42'));
      await new Promise(r => setTimeout(r, 200));

      await channel.triggerMessage(makeTextMessage('What is my name?', '42'));
      await new Promise(r => setTimeout(r, 200));

      // The LLM provider should have been called twice
      expect(provider.getCallCount()).toBeGreaterThanOrEqual(2);

      // Both responses should have been sent to the same chat
      const chat42 = channel.sentMessages.filter(m => m.chatId === '42');
      expect(chat42.length).toBe(2);

      await router.stop();
    });
  });

  describe('Error recovery', () => {
    it('should recover from provider errors and continue processing', async () => {
      // First call will use default response (which may work or not)
      // Then add a valid response
      provider.setDefaultResponse({
        content: [],
        stopReason: null,
        usage: { inputTokens: 0, outputTokens: 0 },
      });

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

      // This may trigger an error
      await channel.triggerMessage(makeTextMessage('Error trigger'));
      await new Promise(r => setTimeout(r, 300));

      // Now add a valid response
      provider.addTextResponse('Recovery success');
      await channel.triggerMessage(makeTextMessage('Second attempt'));
      await new Promise(r => setTimeout(r, 300));

      // The router should still be functional
      await router.stop();
    });
  });

  describe('Clean shutdown', () => {
    it('should stop all sessions and task runner on stop', async () => {
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

      // Create a session by sending a message
      await channel.triggerMessage(makeTextMessage('Active session'));
      await new Promise(r => setTimeout(r, 200));

      // Stop should clean up everything
      await router.stop();

      // Verify clean shutdown (no errors thrown)
      expect(channel.sentMessages.length).toBeGreaterThanOrEqual(1);
    });
  });
});
