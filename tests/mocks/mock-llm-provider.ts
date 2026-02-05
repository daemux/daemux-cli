/**
 * Mock LLM Provider
 * Implements LLMProvider interface for testing
 */

import type {
  LLMProvider,
  LLMProviderCapabilities,
  LLMModel,
  LLMCredentials,
  LLMChatOptions,
  LLMChatChunk,
  LLMChatResponse,
} from '../../src/core/plugin-api-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MockChatResponse {
  content: Array<{
    type: 'text' | 'tool_use';
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | null;
  usage: { inputTokens: number; outputTokens: number };
}

export interface MockCallRecord {
  model: string;
  messages: Array<{ role: string; content: string | unknown[] }>;
  tools?: unknown[];
  maxTokens?: number;
  systemPrompt?: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Mock LLM Provider Class
// ---------------------------------------------------------------------------

export class MockLLMProvider implements LLMProvider {
  id = 'mock';
  name = 'Mock Provider';
  capabilities: LLMProviderCapabilities = {
    streaming: true,
    toolUse: true,
    vision: false,
    maxContextWindow: 200000,
  };

  private responses: MockChatResponse[] = [];
  private responseIndex = 0;
  private callHistory: MockCallRecord[] = [];
  private initialized = false;
  private defaultResponse: MockChatResponse = {
    content: [{ type: 'text', text: 'Default mock response' }],
    stopReason: 'end_turn',
    usage: { inputTokens: 100, outputTokens: 50 },
  };

  // ---------------------------------------------------------------------------
  // LLMProvider Interface Implementation
  // ---------------------------------------------------------------------------

  async initialize(credentials: LLMCredentials): Promise<void> {
    this.initialized = true;
  }

  isReady(): boolean {
    return this.initialized;
  }

  async verifyCredentials(credentials: LLMCredentials): Promise<{ valid: boolean; error?: string }> {
    if (credentials.value === 'invalid') {
      return { valid: false, error: 'Invalid mock credentials' };
    }
    return { valid: true };
  }

  listModels(): LLMModel[] {
    return [
      {
        id: 'mock-model',
        name: 'Mock Model',
        contextWindow: 200000,
        maxOutputTokens: 8192,
      },
      {
        id: 'mock-haiku',
        name: 'Mock Haiku',
        contextWindow: 200000,
        maxOutputTokens: 4096,
      },
    ];
  }

  getDefaultModel(): string {
    return 'mock-model';
  }

  async *chat(options: LLMChatOptions): AsyncGenerator<LLMChatChunk> {
    // Record the call
    this.callHistory.push({
      model: options.model,
      messages: options.messages,
      tools: options.tools,
      maxTokens: options.maxTokens,
      systemPrompt: options.systemPrompt,
      timestamp: Date.now(),
    });

    // Get response from queue or default
    const response = this.responseIndex < this.responses.length
      ? this.responses[this.responseIndex++]
      : this.defaultResponse;

    // Yield content chunks
    for (const block of response.content) {
      if (block.type === 'text' && block.text) {
        yield {
          type: 'text',
          content: block.text,
        };
      } else if (block.type === 'tool_use') {
        yield {
          type: 'tool_use',
          toolUseId: block.id,
          toolName: block.name,
          toolInput: block.input,
        };
      }
    }

    // Yield done chunk
    yield {
      type: 'done',
      stopReason: response.stopReason ?? 'end_turn',
      usage: response.usage,
    };
  }

  async compactionChat(options: LLMChatOptions): Promise<LLMChatResponse> {
    // Record the call
    this.callHistory.push({
      model: options.model,
      messages: options.messages,
      tools: options.tools,
      maxTokens: options.maxTokens,
      systemPrompt: options.systemPrompt,
      timestamp: Date.now(),
    });

    // Get response from queue or default
    const response = this.responseIndex < this.responses.length
      ? this.responses[this.responseIndex++]
      : this.defaultResponse;

    return response;
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    this.reset();
  }

  // ---------------------------------------------------------------------------
  // Test Helper Methods
  // ---------------------------------------------------------------------------

  addResponse(response: Partial<MockChatResponse>): this {
    this.responses.push({
      content: [{ type: 'text', text: 'Mock response' }],
      stopReason: 'end_turn',
      usage: { inputTokens: 100, outputTokens: 50 },
      ...response,
    });
    return this;
  }

  addTextResponse(text: string, stopReason: MockChatResponse['stopReason'] = 'end_turn'): this {
    return this.addResponse({
      content: [{ type: 'text', text }],
      stopReason,
    });
  }

  addToolUseResponse(
    toolName: string,
    toolInput: Record<string, unknown>,
    toolId = `tool_${Date.now()}`
  ): this {
    return this.addResponse({
      content: [{ type: 'tool_use', id: toolId, name: toolName, input: toolInput }],
      stopReason: 'tool_use',
    });
  }

  addMultiToolResponse(tools: Array<{ name: string; input: Record<string, unknown>; id?: string }>): this {
    return this.addResponse({
      content: tools.map((tool, index) => ({
        type: 'tool_use' as const,
        id: tool.id ?? `tool_${index}_${Date.now()}`,
        name: tool.name,
        input: tool.input,
      })),
      stopReason: 'tool_use',
    });
  }

  addMixedResponse(
    text: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    toolId = `tool_${Date.now()}`
  ): this {
    return this.addResponse({
      content: [
        { type: 'text', text },
        { type: 'tool_use', id: toolId, name: toolName, input: toolInput },
      ],
      stopReason: 'tool_use',
    });
  }

  setDefaultResponse(response: Partial<MockChatResponse>): this {
    this.defaultResponse = { ...this.defaultResponse, ...response };
    return this;
  }

  getCallHistory(): MockCallRecord[] {
    return [...this.callHistory];
  }

  getLastCall(): MockCallRecord | undefined {
    return this.callHistory[this.callHistory.length - 1];
  }

  getCallCount(): number {
    return this.callHistory.length;
  }

  reset(): this {
    this.responses = [];
    this.responseIndex = 0;
    this.callHistory = [];
    return this;
  }

  /** Mark as initialized for testing without calling initialize() */
  setReady(ready = true): this {
    this.initialized = ready;
    return this;
  }
}

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

export function createMockLLMProvider(): MockLLMProvider {
  return new MockLLMProvider();
}

export function createReadyMockProvider(): MockLLMProvider {
  return new MockLLMProvider().setReady(true);
}
