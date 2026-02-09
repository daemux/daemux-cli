/**
 * Complexity Classifier Tests
 * Tests task classification into simple, medium, or complex.
 */

import { describe, it, expect } from 'bun:test';
import { ComplexityClassifier } from '../../src/core/complexity-classifier';
import type { ClassifierDeps } from '../../src/core/complexity-classifier';
import type { LLMProvider, LLMChatResponse } from '../../src/core/plugin-api-types';

// ---------------------------------------------------------------------------
// Mock Helpers
// ---------------------------------------------------------------------------

function makeLLMResponse(text: string): LLMChatResponse {
  return {
    content: [{ type: 'text', text }],
    stopReason: 'end_turn',
    usage: { inputTokens: 50, outputTokens: 5 },
  };
}

function makeMockProvider(responseText: string): LLMProvider {
  return {
    id: 'mock',
    name: 'Mock Provider',
    capabilities: { streaming: true, toolUse: true, vision: false, maxContextWindow: 200000 },
    initialize: async () => {},
    isReady: () => true,
    verifyCredentials: async () => ({ valid: true }),
    listModels: () => [],
    getDefaultModel: () => 'claude-haiku-3-5-20250514',
    chat: async function* () { yield { type: 'done' as const, stopReason: 'end_turn' as const }; },
    compactionChat: async () => makeLLMResponse(responseText),
    shutdown: async () => {},
  };
}

function makeDeps(responseText: string): ClassifierDeps {
  return { provider: makeMockProvider(responseText) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ComplexityClassifier', () => {
  describe('classify', () => {
    it('should classify simple tasks', async () => {
      const classifier = new ComplexityClassifier(makeDeps('simple'));

      const result = await classifier.classify('What is 2+2?');

      expect(result).toBe('simple');
    });

    it('should classify medium tasks', async () => {
      const classifier = new ComplexityClassifier(makeDeps('medium'));

      const result = await classifier.classify('Fix the bug in login.ts');

      expect(result).toBe('medium');
    });

    it('should classify complex tasks', async () => {
      const classifier = new ComplexityClassifier(makeDeps('complex'));

      const result = await classifier.classify(
        'Refactor the authentication system across all modules and add OAuth2 support',
      );

      expect(result).toBe('complex');
    });

    it('should handle LLM failure by defaulting to medium', async () => {
      const provider = makeMockProvider('simple');
      provider.compactionChat = async () => {
        throw new Error('Network timeout');
      };

      const classifier = new ComplexityClassifier({ provider });

      const result = await classifier.classify('Some task');

      expect(result).toBe('medium');
    });

    it('should use haiku model for classification', async () => {
      let capturedModel = '';
      const provider = makeMockProvider('simple');
      provider.compactionChat = async (options) => {
        capturedModel = options.model;
        return makeLLMResponse('simple');
      };

      const classifier = new ComplexityClassifier({ provider });
      await classifier.classify('Hello');

      expect(capturedModel).toBe('claude-haiku-3-5-20250514');
    });

    it('should return simple for empty task', async () => {
      const classifier = new ComplexityClassifier(makeDeps('medium'));

      const result = await classifier.classify('');

      expect(result).toBe('simple');
    });

    it('should return simple for whitespace-only task', async () => {
      const classifier = new ComplexityClassifier(makeDeps('medium'));

      const result = await classifier.classify('   ');

      expect(result).toBe('simple');
    });

    it('should handle response with extra whitespace', async () => {
      const classifier = new ComplexityClassifier(makeDeps('  complex  '));

      const result = await classifier.classify('Big refactoring task');

      expect(result).toBe('complex');
    });

    it('should handle response with mixed case', async () => {
      const classifier = new ComplexityClassifier(makeDeps('MEDIUM'));

      const result = await classifier.classify('Debug something');

      expect(result).toBe('medium');
    });

    it('should extract complexity from verbose response', async () => {
      const classifier = new ComplexityClassifier(
        makeDeps('I think this is a complex task because it spans multiple files'),
      );

      const result = await classifier.classify('Refactor everything');

      expect(result).toBe('complex');
    });

    it('should default to medium for unparseable response', async () => {
      const classifier = new ComplexityClassifier(makeDeps('banana'));

      const result = await classifier.classify('Some task');

      expect(result).toBe('medium');
    });

    it('should handle empty LLM response content', async () => {
      const provider = makeMockProvider('');
      provider.compactionChat = async () => ({
        content: [],
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
      });

      const classifier = new ComplexityClassifier({ provider });
      const result = await classifier.classify('Some task');

      expect(result).toBe('medium');
    });

    it('should include context in the LLM call when provided', async () => {
      let capturedMessages: Array<{ role: string; content: string | unknown[] }> = [];
      const provider = makeMockProvider('medium');
      provider.compactionChat = async (options) => {
        capturedMessages = options.messages;
        return makeLLMResponse('medium');
      };

      const classifier = new ComplexityClassifier({ provider });
      await classifier.classify('Fix the bug', 'In the auth module');

      expect(capturedMessages.length).toBe(1);
      const content = capturedMessages[0].content as string;
      expect(content).toContain('Fix the bug');
      expect(content).toContain('In the auth module');
    });

    it('should not include context line when context is not provided', async () => {
      let capturedMessages: Array<{ role: string; content: string | unknown[] }> = [];
      const provider = makeMockProvider('simple');
      provider.compactionChat = async (options) => {
        capturedMessages = options.messages;
        return makeLLMResponse('simple');
      };

      const classifier = new ComplexityClassifier({ provider });
      await classifier.classify('What is TypeScript?');

      const content = capturedMessages[0].content as string;
      expect(content).toContain('What is TypeScript?');
      expect(content).not.toContain('Context:');
    });

    it('should prefer "simple" when response contains multiple complexity words', async () => {
      // "simple" comes first in the valid list, so it should be matched first
      const classifier = new ComplexityClassifier(
        makeDeps('This is simple but could be complex'),
      );

      const result = await classifier.classify('Something');

      expect(result).toBe('simple');
    });

    it('should set maxTokens to 10 for fast classification', async () => {
      let capturedMaxTokens = 0;
      const provider = makeMockProvider('simple');
      provider.compactionChat = async (options) => {
        capturedMaxTokens = options.maxTokens ?? 0;
        return makeLLMResponse('simple');
      };

      const classifier = new ComplexityClassifier({ provider });
      await classifier.classify('What is 2+2?');

      expect(capturedMaxTokens).toBe(10);
    });
  });
});
