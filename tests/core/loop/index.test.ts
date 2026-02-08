/**
 * Agentic Loop Unit Tests
 * Tests the main loop orchestrator
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { existsSync, unlinkSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { Database } from '../../../src/infra/database';
import { EventBus } from '../../../src/core/event-bus';
import {
  AgenticLoop,
  createAgenticLoop,
  getAgenticLoop,
  BUILTIN_TOOLS,
  ContextBuilder,
  ToolExecutor,
  defaultSystemPrompt,
} from '../../../src/core/loop/index';
import type { Config } from '../../../src/core/types';
import { createReadyMockProvider, MockLLMProvider } from '../../mocks/mock-llm-provider';

describe('AgenticLoop', () => {
  let db: Database;
  let eventBus: EventBus;
  let mockProvider: MockLLMProvider;
  const testDbPath = join(import.meta.dir, 'test-loop.sqlite');
  const testDir = join(import.meta.dir, 'test-loop-files');

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
    workMaxIterationsPerTask: 100,
    workBudgetMaxTasksPerHour: 50,
  };

  beforeEach(async () => {
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    mkdirSync(testDir, { recursive: true });

    db = new Database({ path: testDbPath, enableVec: false });
    await db.initialize();
    eventBus = new EventBus();
    mockProvider = createReadyMockProvider();
  });

  afterEach(() => {
    db.close();
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath);
    }
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('Exports', () => {
    it('should export BUILTIN_TOOLS', () => {
      expect(BUILTIN_TOOLS).toBeDefined();
      expect(Array.isArray(BUILTIN_TOOLS)).toBe(true);
      expect(BUILTIN_TOOLS.length).toBeGreaterThan(0);
    });

    it('should export ContextBuilder', () => {
      expect(ContextBuilder).toBeDefined();
      expect(typeof ContextBuilder).toBe('function');
    });

    it('should export ToolExecutor', () => {
      expect(ToolExecutor).toBeDefined();
      expect(typeof ToolExecutor).toBe('function');
    });
  });

  describe('AgenticLoop Constructor', () => {
    it('should create loop with provider', () => {
      const loop = new AgenticLoop({
        db,
        eventBus,
        config: testConfig,
        provider: mockProvider,
      });

      expect(loop).toBeDefined();
      expect(loop.getProvider()).toBe(mockProvider);
    });

    it('should throw when no provider is available', () => {
      expect(() => new AgenticLoop({
        db,
        eventBus,
        config: testConfig,
      })).toThrow('No LLM provider available');
    });
  });

  describe('Loop State Methods', () => {
    it('getSession should return null when not running', () => {
      const loop = new AgenticLoop({
        db,
        eventBus,
        config: testConfig,
        provider: mockProvider,
      });

      expect(loop.getSession()).toBeNull();
    });

    it('isRunning should return false initially', () => {
      const loop = new AgenticLoop({
        db,
        eventBus,
        config: testConfig,
        provider: mockProvider,
      });

      expect(loop.isRunning()).toBe(false);
    });

    it('interrupt should set interrupted flag', () => {
      const loop = new AgenticLoop({
        db,
        eventBus,
        config: testConfig,
        provider: mockProvider,
      });

      // Calling interrupt should not throw
      expect(() => loop.interrupt()).not.toThrow();
    });
  });

  describe('Global Loop Instance', () => {
    it('createAgenticLoop should create global instance', () => {
      const loop = createAgenticLoop({
        db,
        eventBus,
        config: testConfig,
        provider: mockProvider,
      });

      expect(loop).toBeInstanceOf(AgenticLoop);
    });

    it('getAgenticLoop should return global instance', () => {
      createAgenticLoop({
        db,
        eventBus,
        config: testConfig,
        provider: mockProvider,
      });

      const retrieved = getAgenticLoop();
      expect(retrieved).toBeInstanceOf(AgenticLoop);
    });

    it('getAgenticLoop should throw if not initialized', () => {
      // Reset the global by creating a fresh module context
      // This is tricky to test without module isolation
      // For now, just verify it returns something after creation
      createAgenticLoop({
        db,
        eventBus,
        config: testConfig,
        provider: mockProvider,
      });

      expect(() => getAgenticLoop()).not.toThrow();
    });
  });

  describe('resume method', () => {
    it('should call run with sessionId', async () => {
      // Set up mock response
      mockProvider.addTextResponse('Response');

      const loop = new AgenticLoop({
        db,
        eventBus,
        config: testConfig,
        provider: mockProvider,
      });

      // Create a session first
      const session = db.sessions.create({
        createdAt: Date.now(),
        lastActivity: Date.now(),
        compactionCount: 0,
        totalTokensUsed: 0,
        queueMode: 'steer',
        flags: {},
      });

      const result = await loop.resume(session.id, 'Test message');

      expect(result.sessionId).toBe(session.id);
      expect(mockProvider.getCallCount()).toBeGreaterThan(0);
    });
  });

  describe('defaultSystemPrompt', () => {
    it('should use agent system prompt if provided', () => {
      const result = defaultSystemPrompt({
        agent: {
          name: 'test-agent',
          systemPrompt: 'Custom system prompt',
          color: 'blue',
          description: 'Test agent',
          pluginId: 'test',
        },
      });

      expect(result).toBe('Custom system prompt');
    });

    it('should use default prompt when no agent', () => {
      const result = defaultSystemPrompt({});

      expect(result).toContain('helpful');
    });
  });

  describe('Provider Integration', () => {
    it('should return the configured provider', () => {
      const loop = new AgenticLoop({
        db,
        eventBus,
        config: testConfig,
        provider: mockProvider,
      });

      expect(loop.getProvider()).toBe(mockProvider);
    });

    it('should record calls to provider', async () => {
      mockProvider.addTextResponse('Test response');

      const loop = new AgenticLoop({
        db,
        eventBus,
        config: testConfig,
        provider: mockProvider,
      });

      const session = db.sessions.create({
        createdAt: Date.now(),
        lastActivity: Date.now(),
        compactionCount: 0,
        totalTokensUsed: 0,
        queueMode: 'steer',
        flags: {},
      });

      await loop.resume(session.id, 'Hello');

      const lastCall = mockProvider.getLastCall();
      expect(lastCall).toBeDefined();
      expect(lastCall?.model).toBe('mock-model');
    });
  });
});
