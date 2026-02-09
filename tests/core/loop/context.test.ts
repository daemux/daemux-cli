/**
 * Context Builder Unit Tests
 * Tests context building, message conversion, and compaction
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';
import { Database } from '../../../src/infra/database';
import { EventBus } from '../../../src/core/event-bus';
import { ContextBuilder } from '../../../src/core/loop/context';
import { validateChain, updateActivity } from '../../../src/core/loop/compaction';
import type { Config, Message } from '../../../src/core/types';
import { createReadyMockProvider, MockLLMProvider } from '../../mocks/mock-llm-provider';

describe('ContextBuilder', () => {
  let db: Database;
  let eventBus: EventBus;
  let mockProvider: MockLLMProvider;
  let contextBuilder: ContextBuilder;
  const testDbPath = join(import.meta.dir, 'test-context.sqlite');

  const testConfig: Config = {
    agentId: 'test-agent',
    dataDir: '/tmp/test',
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

  beforeEach(async () => {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }

    db = new Database({ path: testDbPath, enableVec: false });
    await db.initialize();
    eventBus = new EventBus();
    mockProvider = createReadyMockProvider();

    // Add a default response for compaction
    mockProvider.addTextResponse('Summary of conversation.');

    contextBuilder = new ContextBuilder({
      db,
      eventBus,
      config: testConfig,
      provider: mockProvider,
    });
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
  });

  describe('build', () => {
    it('should create new session if not exists', async () => {
      const context = await contextBuilder.build('new-session-id', 'Test prompt');

      expect(context.sessionId).toBeDefined();
      expect(context.messages).toHaveLength(0);
      expect(context.tokenCount).toBe(0);
    });

    it('should load existing session', async () => {
      // Create a session first
      const session = db.sessions.create({
        createdAt: Date.now(),
        lastActivity: Date.now(),
        compactionCount: 2,
        totalTokensUsed: 5000,
        queueMode: 'steer',
        flags: {},
      });

      // Add some messages
      db.messages.create(session.id, {
        parentUuid: null,
        role: 'user',
        content: 'Hello',
        createdAt: Date.now(),
        tokenCount: 10,
      });

      const context = await contextBuilder.build(session.id, 'Test prompt');

      expect(context.sessionId).toBe(session.id);
      expect(context.messages).toHaveLength(1);
      expect(context.compactionCount).toBe(2);
    });

    it('should calculate token count', async () => {
      const session = db.sessions.create({
        createdAt: Date.now(),
        lastActivity: Date.now(),
        compactionCount: 0,
        totalTokensUsed: 0,
        queueMode: 'steer',
        flags: {},
      });

      db.messages.create(session.id, {
        parentUuid: null,
        role: 'user',
        content: 'Hello',
        createdAt: Date.now(),
        tokenCount: 100,
      });

      db.messages.create(session.id, {
        parentUuid: null,
        role: 'assistant',
        content: 'Hi there',
        createdAt: Date.now() + 1,
        tokenCount: 50,
      });

      const context = await contextBuilder.build(session.id, 'Test prompt');

      expect(context.tokenCount).toBe(150);
    });
  });

  describe('toAPIMessages', () => {
    it('should convert string messages', () => {
      const messages: Message[] = [
        {
          uuid: 'msg-1',
          parentUuid: null,
          role: 'user',
          content: 'Hello',
          createdAt: Date.now(),
        },
        {
          uuid: 'msg-2',
          parentUuid: 'msg-1',
          role: 'assistant',
          content: 'Hi there',
          createdAt: Date.now(),
        },
      ];

      const apiMessages = contextBuilder.toAPIMessages(messages);

      expect(apiMessages).toHaveLength(2);
      expect(apiMessages[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(apiMessages[1]).toEqual({ role: 'assistant', content: 'Hi there' });
    });

    it('should convert content blocks', () => {
      const messages: Message[] = [
        {
          uuid: 'msg-1',
          parentUuid: null,
          role: 'assistant',
          content: [
            { type: 'text', text: 'Here is the result' },
            { type: 'tool_use', id: 'tool-1', name: 'read_file', input: { path: '/test' } },
          ],
          createdAt: Date.now(),
        },
      ];

      const apiMessages = contextBuilder.toAPIMessages(messages);

      expect(apiMessages).toHaveLength(1);
      expect(Array.isArray(apiMessages[0]?.content)).toBe(true);
    });

    it('should skip system messages', () => {
      const messages: Message[] = [
        {
          uuid: 'msg-1',
          parentUuid: null,
          role: 'system',
          content: 'System message',
          createdAt: Date.now(),
        },
        {
          uuid: 'msg-2',
          parentUuid: null,
          role: 'user',
          content: 'User message',
          createdAt: Date.now(),
        },
      ];

      const apiMessages = contextBuilder.toAPIMessages(messages);

      expect(apiMessages).toHaveLength(1);
      expect(apiMessages[0]?.role).toBe('user');
    });

    it('should handle empty messages array', () => {
      const apiMessages = contextBuilder.toAPIMessages([]);
      expect(apiMessages).toHaveLength(0);
    });
  });

  describe('addMessage', () => {
    it('should add user message', () => {
      const session = db.sessions.create({
        createdAt: Date.now(),
        lastActivity: Date.now(),
        compactionCount: 0,
        totalTokensUsed: 0,
        queueMode: 'steer',
        flags: {},
      });

      const msg = contextBuilder.addMessage(session.id, 'user', 'Hello');

      expect(msg.uuid).toBeDefined();
      expect(msg.role).toBe('user');
      expect(msg.content).toBe('Hello');
    });

    it('should add assistant message with parent', () => {
      const session = db.sessions.create({
        createdAt: Date.now(),
        lastActivity: Date.now(),
        compactionCount: 0,
        totalTokensUsed: 0,
        queueMode: 'steer',
        flags: {},
      });

      const userMsg = contextBuilder.addMessage(session.id, 'user', 'Hello');
      const assistantMsg = contextBuilder.addMessage(session.id, 'assistant', 'Hi', userMsg.uuid);

      expect(assistantMsg.parentUuid).toBe(userMsg.uuid);
    });

    it('should add message with token count', () => {
      const session = db.sessions.create({
        createdAt: Date.now(),
        lastActivity: Date.now(),
        compactionCount: 0,
        totalTokensUsed: 0,
        queueMode: 'steer',
        flags: {},
      });

      const msg = contextBuilder.addMessage(session.id, 'assistant', 'Response', null, 150);

      expect(msg.tokenCount).toBe(150);
    });

    it('should add content blocks', () => {
      const session = db.sessions.create({
        createdAt: Date.now(),
        lastActivity: Date.now(),
        compactionCount: 0,
        totalTokensUsed: 0,
        queueMode: 'steer',
        flags: {},
      });

      const content = [
        { type: 'text' as const, text: 'Result' },
        { type: 'tool_use' as const, id: 'tool-1', name: 'bash', input: { command: 'ls' } },
      ];

      const msg = contextBuilder.addMessage(session.id, 'assistant', content);

      expect(Array.isArray(msg.content)).toBe(true);
    });
  });

  describe('needsCompaction', () => {
    it('should return false when under threshold', () => {
      const threshold = testConfig.effectiveContextWindow * testConfig.compactionThreshold;
      expect(contextBuilder.needsCompaction(threshold - 1000)).toBe(false);
    });

    it('should return true when over threshold', () => {
      const threshold = testConfig.effectiveContextWindow * testConfig.compactionThreshold;
      expect(contextBuilder.needsCompaction(threshold + 1000)).toBe(true);
    });

    it('should return false for zero tokens', () => {
      expect(contextBuilder.needsCompaction(0)).toBe(false);
    });
  });

  describe('atLimit', () => {
    it('should return false when under limit', () => {
      const limit = testConfig.effectiveContextWindow * 0.98;
      expect(contextBuilder.atLimit(limit - 1000)).toBe(false);
    });

    it('should return true when over limit', () => {
      const limit = testConfig.effectiveContextWindow * 0.98;
      expect(contextBuilder.atLimit(limit + 1000)).toBe(true);
    });
  });

  describe('compact', () => {
    it('should summarize conversation', async () => {
      const session = db.sessions.create({
        createdAt: Date.now(),
        lastActivity: Date.now(),
        compactionCount: 0,
        totalTokensUsed: 0,
        queueMode: 'steer',
        flags: {},
      });

      // Add several messages
      for (let i = 0; i < 5; i++) {
        db.messages.create(session.id, {
          parentUuid: null,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}`,
          createdAt: Date.now() + i,
          tokenCount: 100,
        });
      }

      const result = await contextBuilder.compact(session.id, 'Test prompt');

      expect(result.summary).toContain('Summary');
      expect(result.beforeTokens).toBe(500);
    });

    it('should emit session:compact event', async () => {
      const session = db.sessions.create({
        createdAt: Date.now(),
        lastActivity: Date.now(),
        compactionCount: 0,
        totalTokensUsed: 0,
        queueMode: 'steer',
        flags: {},
      });

      for (let i = 0; i < 5; i++) {
        db.messages.create(session.id, {
          parentUuid: null,
          role: 'user',
          content: `Message ${i}`,
          createdAt: Date.now() + i,
        });
      }

      let eventEmitted = false;
      eventBus.on('session:compact', () => {
        eventEmitted = true;
      });

      await contextBuilder.compact(session.id, 'Test prompt');

      expect(eventEmitted).toBe(true);
    });

    it('should increment compaction count', async () => {
      const session = db.sessions.create({
        createdAt: Date.now(),
        lastActivity: Date.now(),
        compactionCount: 0,
        totalTokensUsed: 0,
        queueMode: 'steer',
        flags: {},
      });

      for (let i = 0; i < 5; i++) {
        db.messages.create(session.id, {
          parentUuid: null,
          role: 'user',
          content: `Message ${i}`,
          createdAt: Date.now() + i,
        });
      }

      await contextBuilder.compact(session.id, 'Test prompt');

      const updatedSession = db.sessions.get(session.id);
      expect(updatedSession?.compactionCount).toBe(1);
    });

    it('should skip compaction with too few messages', async () => {
      const session = db.sessions.create({
        createdAt: Date.now(),
        lastActivity: Date.now(),
        compactionCount: 0,
        totalTokensUsed: 0,
        queueMode: 'steer',
        flags: {},
      });

      db.messages.create(session.id, {
        parentUuid: null,
        role: 'user',
        content: 'Only message',
        createdAt: Date.now(),
        tokenCount: 100,
      });

      const result = await contextBuilder.compact(session.id, 'Test prompt');

      expect(result.summary).toBe('');
      expect(result.beforeTokens).toBe(result.afterTokens);
    });
  });

  describe('validateChain', () => {
    it('should validate correct chain', () => {
      const session = db.sessions.create({
        createdAt: Date.now(),
        lastActivity: Date.now(),
        compactionCount: 0,
        totalTokensUsed: 0,
        queueMode: 'steer',
        flags: {},
      });

      db.messages.create(session.id, {
        parentUuid: null,
        role: 'user',
        content: 'Hello',
        createdAt: Date.now(),
      });

      const result = validateChain(db, session.id);

      expect(result.valid).toBe(true);
    });

    it('should handle empty session', () => {
      const session = db.sessions.create({
        createdAt: Date.now(),
        lastActivity: Date.now(),
        compactionCount: 0,
        totalTokensUsed: 0,
        queueMode: 'steer',
        flags: {},
      });

      const result = validateChain(db, session.id);

      expect(result.valid).toBe(true);
    });
  });

  describe('updateActivity', () => {
    it('should update session activity', async () => {
      const session = db.sessions.create({
        createdAt: Date.now(),
        lastActivity: Date.now() - 10000,
        compactionCount: 0,
        totalTokensUsed: 1000,
        queueMode: 'steer',
        flags: {},
      });

      await updateActivity(db, session.id, 500);

      const updated = db.sessions.get(session.id);
      expect(updated?.totalTokensUsed).toBe(1500);
      expect(updated?.lastActivity).toBeGreaterThan(session.lastActivity);
    });

    it('should handle non-existent session', async () => {
      // Should not throw
      await updateActivity(db, 'nonexistent', 500);
    });
  });
});
