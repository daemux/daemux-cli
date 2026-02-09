/**
 * Agent Factory Tests
 * Tests dynamic agent creation via LLM calls.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { AgentFactory } from '../../src/core/agent-factory';
import type { AgentFactoryDeps } from '../../src/core/agent-factory';
import type { LLMProvider, LLMChatResponse } from '../../src/core/plugin-api-types';
import type { AgentDefinition } from '../../src/core/types';

// ---------------------------------------------------------------------------
// Mock Helpers
// ---------------------------------------------------------------------------

function makeValidAgentJson(overrides?: Record<string, unknown>): string {
  return JSON.stringify({
    name: 'code-reviewer',
    description: 'Reviews code for quality issues',
    systemPrompt: 'You are a code reviewer. Check for bugs, style issues, and security problems.',
    tools: ['Read', 'Grep', 'Glob'],
    model: 'haiku',
    color: 'cyan',
    ...overrides,
  });
}

function makeLLMResponse(text: string): LLMChatResponse {
  return {
    content: [{ type: 'text', text }],
    stopReason: 'end_turn',
    usage: { inputTokens: 100, outputTokens: 50 },
  };
}

function makeMockProvider(responseText?: string): LLMProvider {
  const text = responseText ?? makeValidAgentJson();
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
    compactionChat: async () => makeLLMResponse(text),
    shutdown: async () => {},
  };
}

function makeMockRegistry(): {
  registry: { registerAgent: (a: AgentDefinition) => void; hasAgent: (n: string) => boolean };
  registered: AgentDefinition[];
} {
  const registered: AgentDefinition[] = [];
  return {
    registry: {
      registerAgent: (agent: AgentDefinition) => registered.push(agent),
      hasAgent: (name: string) => registered.some(a => a.name === name),
    },
    registered,
  };
}

function makeDeps(
  providerOverride?: LLMProvider,
  registryOverride?: { registerAgent: (a: AgentDefinition) => void; hasAgent: (n: string) => boolean },
): { deps: AgentFactoryDeps; registered: AgentDefinition[] } {
  const { registry, registered } = makeMockRegistry();
  return {
    deps: {
      provider: providerOverride ?? makeMockProvider(),
      registry: (registryOverride ?? registry) as AgentFactoryDeps['registry'],
    },
    registered,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentFactory', () => {
  describe('createAgent', () => {
    it('should create an agent from a task description', async () => {
      const { deps } = makeDeps();
      const factory = new AgentFactory(deps);

      const agent = await factory.createAgent('Review TypeScript code for security issues');

      expect(agent.name).toBe('code-reviewer');
      expect(agent.description).toBe('Reviews code for quality issues');
      expect(agent.systemPrompt).toContain('code reviewer');
      expect(agent.pluginId).toBe('dynamic');
    });

    it('should use haiku model for the generation call', async () => {
      let capturedModel = '';
      const provider = makeMockProvider();
      provider.compactionChat = async (options) => {
        capturedModel = options.model;
        return makeLLMResponse(makeValidAgentJson());
      };

      const { deps } = makeDeps(provider);
      const factory = new AgentFactory(deps);
      await factory.createAgent('Some task');

      expect(capturedModel).toBe('claude-haiku-3-5-20250514');
    });

    it('should register the agent in the registry', async () => {
      const { deps, registered } = makeDeps();
      const factory = new AgentFactory(deps);

      await factory.createAgent('Build a test runner');

      expect(registered.length).toBe(1);
      expect(registered[0].name).toBe('code-reviewer');
    });

    it('should set pluginId to dynamic', async () => {
      const { deps } = makeDeps();
      const factory = new AgentFactory(deps);

      const agent = await factory.createAgent('Create a linter');

      expect(agent.pluginId).toBe('dynamic');
    });

    it('should respect tool whitelist override', async () => {
      const { deps } = makeDeps();
      const factory = new AgentFactory(deps);

      const agent = await factory.createAgent('Read-only exploration', {
        tools: ['Read', 'Glob'],
      });

      expect(agent.tools).toEqual(['Read', 'Glob']);
    });

    it('should respect model override', async () => {
      const { deps } = makeDeps();
      const factory = new AgentFactory(deps);

      const agent = await factory.createAgent('Complex reasoning task', {
        model: 'opus',
      });

      expect(agent.model).toBe('opus');
    });

    it('should handle LLM failure gracefully', async () => {
      const provider = makeMockProvider();
      provider.compactionChat = async () => {
        throw new Error('API rate limit exceeded');
      };

      const { deps } = makeDeps(provider);
      const factory = new AgentFactory(deps);

      await expect(factory.createAgent('Some task')).rejects.toThrow(
        'Failed to generate agent config: API rate limit exceeded',
      );
    });

    it('should throw on empty task description', async () => {
      const { deps } = makeDeps();
      const factory = new AgentFactory(deps);

      await expect(factory.createAgent('')).rejects.toThrow('Task description is required');
    });

    it('should throw on whitespace-only task description', async () => {
      const { deps } = makeDeps();
      const factory = new AgentFactory(deps);

      await expect(factory.createAgent('   ')).rejects.toThrow('Task description is required');
    });

    it('should handle JSON wrapped in markdown code fences', async () => {
      const wrappedJson = '```json\n' + makeValidAgentJson() + '\n```';
      const { deps } = makeDeps(makeMockProvider(wrappedJson));
      const factory = new AgentFactory(deps);

      const agent = await factory.createAgent('Some task');

      expect(agent.name).toBe('code-reviewer');
    });

    it('should handle invalid JSON response', async () => {
      const { deps } = makeDeps(makeMockProvider('not valid json at all'));
      const factory = new AgentFactory(deps);

      await expect(factory.createAgent('Some task')).rejects.toThrow('Failed to parse agent config JSON');
    });

    it('should handle invalid agent name in response', async () => {
      const invalidName = makeValidAgentJson({ name: '123-bad-name' });
      const { deps } = makeDeps(makeMockProvider(invalidName));
      const factory = new AgentFactory(deps);

      await expect(factory.createAgent('Some task')).rejects.toThrow('Invalid agent name');
    });

    it('should handle empty LLM response', async () => {
      const provider = makeMockProvider();
      provider.compactionChat = async () => ({
        content: [],
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
      });

      const { deps } = makeDeps(provider);
      const factory = new AgentFactory(deps);

      await expect(factory.createAgent('Some task')).rejects.toThrow('no text content');
    });

    it('should default invalid model to inherit', async () => {
      const json = makeValidAgentJson({ model: 'gpt-4' });
      const { deps } = makeDeps(makeMockProvider(json));
      const factory = new AgentFactory(deps);

      const agent = await factory.createAgent('Some task');

      expect(agent.model).toBe('inherit');
    });

    it('should default invalid color to blue', async () => {
      const json = makeValidAgentJson({ color: 'purple' });
      const { deps } = makeDeps(makeMockProvider(json));
      const factory = new AgentFactory(deps);

      const agent = await factory.createAgent('Some task');

      expect(agent.color).toBe('blue');
    });

    it('should generate unique name when collision exists', async () => {
      const { registry, registered } = makeMockRegistry();
      // Pre-register an agent with the same name
      registry.registerAgent({
        name: 'code-reviewer',
        description: 'Existing',
        model: 'inherit',
        tools: [],
        color: 'blue',
        systemPrompt: 'Existing',
        pluginId: 'core',
      });

      const { deps } = makeDeps(undefined, registry);
      const factory = new AgentFactory(deps);

      const agent = await factory.createAgent('Review code');

      // Name should be different from the existing one
      expect(agent.name).not.toBe('code-reviewer');
      expect(agent.name).toMatch(/^code-reviewer-[a-z0-9]+$/);
      // Should be the second registered agent
      expect(registered.length).toBe(2);
    });

    it('should use generated tools when no override provided', async () => {
      const json = makeValidAgentJson({ tools: ['Read', 'Bash', 'Edit'] });
      const { deps } = makeDeps(makeMockProvider(json));
      const factory = new AgentFactory(deps);

      const agent = await factory.createAgent('Edit some files');

      expect(agent.tools).toEqual(['Read', 'Bash', 'Edit']);
    });

    it('should filter non-string items from tools array', async () => {
      const json = makeValidAgentJson({ tools: ['Read', 42, null, 'Bash'] });
      const { deps } = makeDeps(makeMockProvider(json));
      const factory = new AgentFactory(deps);

      const agent = await factory.createAgent('Some task');

      expect(agent.tools).toEqual(['Read', 'Bash']);
    });

    it('should ignore invalid model override and use generated model', async () => {
      const json = makeValidAgentJson({ model: 'sonnet' });
      const { deps } = makeDeps(makeMockProvider(json));
      const factory = new AgentFactory(deps);

      const agent = await factory.createAgent('Some task', { model: 'invalid-model' });

      expect(agent.model).toBe('sonnet');
    });
  });
});
