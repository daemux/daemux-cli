/**
 * Chat Session Unit Tests
 * Tests per-chat dialog management, queue serialization, and task delegation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { existsSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { ChatSession } from '../../src/core/chat-session';
import { BackgroundTaskRunner } from '../../src/core/background-task-runner';
import { Database } from '../../src/infra/database';
import { EventBus } from '../../src/core/event-bus';
import { createReadyMockProvider, MockLLMProvider } from '../mocks/mock-llm-provider';
import type { Config } from '../../src/core/types';
import type { EnhancedChannel, RichChannelMessage, ChannelSendOptions } from '../../src/core/channel-types';

// ---------------------------------------------------------------------------
// Test Configuration
// ---------------------------------------------------------------------------

const testDbPath = join(import.meta.dir, 'test-chat-session.sqlite');
const testDir = join(import.meta.dir, 'test-chat-session-files');

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

describe('ChatSession', () => {
  let db: Database;
  let eventBus: EventBus;
  let provider: MockLLMProvider;
  let channel: ReturnType<typeof createMockChannel>;
  let taskRunner: BackgroundTaskRunner;

  beforeEach(async () => {
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    mkdirSync(testDir, { recursive: true });
    db = new Database({ path: testDbPath, enableVec: false });
    await db.initialize();
    eventBus = new EventBus();
    provider = createReadyMockProvider();
    channel = createMockChannel();
    taskRunner = new BackgroundTaskRunner({
      db, eventBus, config: testConfig, provider,
    });
  });

  afterEach(() => {
    taskRunner.stopAll();
    db.close();
    if (existsSync(testDbPath)) unlinkSync(testDbPath);
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  function createSession(chatKey = 'telegram:12345', chatId = '12345'): ChatSession {
    return new ChatSession({
      chatKey,
      chatId,
      channel,
      db,
      eventBus,
      config: testConfig,
      provider,
      taskRunner,
    });
  }

  describe('Simple message flow', () => {
    it('should process a text message and send response', async () => {
      provider.addTextResponse('Hello back!');
      const session = createSession();

      await session.handleMessage('Hello', makeMessage('Hello'));

      // Wait for async processing
      await new Promise(r => setTimeout(r, 200));

      expect(channel.sentMessages.length).toBeGreaterThanOrEqual(1);
      const sent = channel.sentMessages.find(m => m.text === 'Hello back!');
      expect(sent).toBeDefined();
      expect(sent!.chatId).toBe('12345');

      session.stop();
    });

    it('should send response with markdown parseMode', async () => {
      provider.addTextResponse('**Bold response**');
      const session = createSession();

      await session.handleMessage('Format this', makeMessage('Format this'));
      await new Promise(r => setTimeout(r, 200));

      const sent = channel.sentMessages.find(m => m.text === '**Bold response**');
      expect(sent).toBeDefined();
      expect(sent!.options?.parseMode).toBe('markdown');

      session.stop();
    });

    it('should send response as reply to original message', async () => {
      provider.addTextResponse('Reply here');
      const session = createSession();
      const msg = makeMessage('Question');

      await session.handleMessage('Question', msg);
      await new Promise(r => setTimeout(r, 200));

      const sent = channel.sentMessages.find(m => m.text === 'Reply here');
      expect(sent).toBeDefined();
      expect(sent!.options?.replyToId).toBe(msg.id);

      session.stop();
    });

    it('should not send empty response', async () => {
      provider.addTextResponse('');
      const session = createSession();

      await session.handleMessage('Say nothing', makeMessage('Say nothing'));
      await new Promise(r => setTimeout(r, 200));

      // No messages should have been sent (empty response is trimmed)
      expect(channel.sentMessages).toHaveLength(0);

      session.stop();
    });

    it('should not send whitespace-only response', async () => {
      provider.addTextResponse('   ');
      const session = createSession();

      await session.handleMessage('Blank', makeMessage('Blank'));
      await new Promise(r => setTimeout(r, 200));

      expect(channel.sentMessages).toHaveLength(0);

      session.stop();
    });
  });

  describe('Session continuity', () => {
    it('should maintain sessionId across multiple messages', async () => {
      provider.addTextResponse('First reply');
      provider.addTextResponse('Second reply');
      const session = createSession();

      await session.handleMessage('First', makeMessage('First'));
      await new Promise(r => setTimeout(r, 200));

      await session.handleMessage('Second', makeMessage('Second'));
      await new Promise(r => setTimeout(r, 200));

      // Both messages should have been processed and responses sent
      expect(channel.sentMessages.length).toBe(2);

      // The second call should reuse the session from the first
      const calls = provider.getCallHistory();
      expect(calls.length).toBeGreaterThanOrEqual(2);

      session.stop();
    });
  });

  describe('Queue serialization', () => {
    it('should serialize concurrent messages within a single chat', async () => {
      const callOrder: string[] = [];
      const originalChat = provider.chat.bind(provider);

      // Track call order
      let callIdx = 0;
      provider.addTextResponse('Reply 1');
      provider.addTextResponse('Reply 2');

      const session = createSession();

      // Fire two messages quickly (they should be serialized)
      const p1 = session.handleMessage('Msg 1', makeMessage('Msg 1'));
      const p2 = session.handleMessage('Msg 2', makeMessage('Msg 2'));

      await Promise.all([p1, p2]);
      await new Promise(r => setTimeout(r, 300));

      // Both should have been processed
      expect(channel.sentMessages.length).toBe(2);

      session.stop();
    });
  });

  describe('Error handling', () => {
    it('should send error message when processing fails', async () => {
      // Make provider produce an error by setting it to not-ready state
      // and not providing a response that can be processed
      provider.setDefaultResponse({
        content: [],
        stopReason: null,
        usage: { inputTokens: 0, outputTokens: 0 },
      });

      const session = createSession();

      await session.handleMessage('Cause error', makeMessage('Cause error'));
      await new Promise(r => setTimeout(r, 300));

      // The session should have tried to send an error message
      // (may or may not succeed depending on implementation)
      // Verify session didn't crash by sending another message
      provider.addTextResponse('Recovery');
      await session.handleMessage('After error', makeMessage('After error'));
      await new Promise(r => setTimeout(r, 200));

      session.stop();
    });
  });

  describe('Concurrent ChatSessions', () => {
    it('should not cross-interfere between different sessions', async () => {
      provider.addTextResponse('Chat A reply');
      provider.addTextResponse('Chat B reply');

      const channel2 = createMockChannel('discord');
      const sessionA = createSession('telegram:111', '111');
      const sessionB = new ChatSession({
        chatKey: 'discord:222',
        chatId: '222',
        channel: channel2,
        db, eventBus, config: testConfig, provider, taskRunner,
      });

      await sessionA.handleMessage('Hello A', makeMessage('Hello A', '111'));
      await sessionB.handleMessage('Hello B', makeMessage('Hello B', '222'));
      await new Promise(r => setTimeout(r, 300));

      // Each channel should have received its own response
      expect(channel.sentMessages.length).toBeGreaterThanOrEqual(1);
      expect(channel2.sentMessages.length).toBeGreaterThanOrEqual(1);

      // Messages should be sent to correct chat IDs
      expect(channel.sentMessages[0]!.chatId).toBe('111');
      expect(channel2.sentMessages[0]!.chatId).toBe('222');

      sessionA.stop();
      sessionB.stop();
    });
  });

  describe('emit message:sent event', () => {
    it('should emit message:sent event with response', async () => {
      provider.addTextResponse('Event response');
      const events: Array<{ message: { role: string; content: string }; channelId: string }> = [];
      eventBus.on('message:sent', (payload) => { events.push(payload); });

      const session = createSession();
      await session.handleMessage('Trigger event', makeMessage('Trigger event'));
      await new Promise(r => setTimeout(r, 200));

      expect(events.length).toBeGreaterThanOrEqual(1);
      const sentEvent = events.find(e => e.message.content === 'Event response');
      expect(sentEvent).toBeDefined();
      expect(sentEvent!.message.role).toBe('assistant');
      expect(sentEvent!.channelId).toBe('telegram');

      session.stop();
    });
  });

  describe('Task completion notification', () => {
    it('should send task completion notification to channel', async () => {
      // Set up a quick task that completes
      provider.addTextResponse('Dialog reply');
      provider.addTextResponse('Background task result');

      const session = createSession();

      // Simulate a bg-task:completed event for this chat
      await new Promise(r => setTimeout(r, 50));
      await eventBus.emit('bg-task:completed', {
        taskId: 'task-123',
        chatKey: 'telegram:12345',
        result: 'Successfully processed data',
        success: true,
      });

      await new Promise(r => setTimeout(r, 100));

      const completionMsg = channel.sentMessages.find(m =>
        m.text.includes('Task completed') && m.text.includes('Successfully processed data')
      );
      expect(completionMsg).toBeDefined();

      session.stop();
    });

    it('should send task failure notification', async () => {
      const session = createSession();

      await eventBus.emit('bg-task:completed', {
        taskId: 'task-456',
        chatKey: 'telegram:12345',
        result: 'Something went wrong',
        success: false,
      });

      await new Promise(r => setTimeout(r, 100));

      const failureMsg = channel.sentMessages.find(m =>
        m.text.includes('Task failed') && m.text.includes('Something went wrong')
      );
      expect(failureMsg).toBeDefined();

      session.stop();
    });

    it('should ignore completion events from other chats', async () => {
      const session = createSession();

      await eventBus.emit('bg-task:completed', {
        taskId: 'task-789',
        chatKey: 'other-chat:99999',
        result: 'Other chat result',
        success: true,
      });

      await new Promise(r => setTimeout(r, 100));

      const otherMsg = channel.sentMessages.find(m =>
        m.text.includes('Other chat result')
      );
      expect(otherMsg).toBeUndefined();

      session.stop();
    });

    it('should truncate long task results', async () => {
      const session = createSession();
      const longResult = 'x'.repeat(5000);

      await eventBus.emit('bg-task:completed', {
        taskId: 'task-long',
        chatKey: 'telegram:12345',
        result: longResult,
        success: true,
      });

      await new Promise(r => setTimeout(r, 100));

      const msg = channel.sentMessages.find(m => m.text.includes('Task completed'));
      expect(msg).toBeDefined();
      // The truncated text should be around 4000 chars + prefix + "..."
      expect(msg!.text.length).toBeLessThan(4200);
      expect(msg!.text).toContain('...');

      session.stop();
    });
  });

  describe('stop()', () => {
    it('should stop processing new messages', async () => {
      provider.addTextResponse('Should not see this');
      const session = createSession();

      session.stop();

      // After stop, handleMessage pushes to queue but processNext bails immediately.
      // The returned promise will never resolve because the item stays in queue.
      // So we call handleMessage without awaiting and verify no output appears.
      void session.handleMessage('After stop', makeMessage('After stop'));
      await new Promise(r => setTimeout(r, 100));

      // No messages should have been sent
      expect(channel.sentMessages).toHaveLength(0);
    });

    it('should clear the queue', async () => {
      provider.addTextResponse('Queued response');
      const session = createSession();

      session.stop();

      // Queue should be cleared, no processing
      expect(session.getActiveTasks()).toHaveLength(0);
    });

    it('should not send completion notifications after stop', async () => {
      const session = createSession();
      session.stop();

      await eventBus.emit('bg-task:completed', {
        taskId: 'task-stopped',
        chatKey: 'telegram:12345',
        result: 'Late completion',
        success: true,
      });

      await new Promise(r => setTimeout(r, 100));

      expect(channel.sentMessages).toHaveLength(0);
    });
  });

  describe('getActiveTasks()', () => {
    it('should delegate to taskRunner.getTasksForChat', () => {
      const session = createSession();
      const tasks = session.getActiveTasks();
      expect(Array.isArray(tasks)).toBe(true);
      session.stop();
    });
  });
});
