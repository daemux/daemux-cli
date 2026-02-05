/**
 * Mock Anthropic Client
 * Simulates Anthropic API responses for testing
 */

import type { ToolDefinition, ToolResult } from '../../src/core/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MockMessage {
  role: 'user' | 'assistant';
  content: string | MockContentBlock[];
}

export type MockContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

export interface MockResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: MockContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | null;
  usage: { input_tokens: number; output_tokens: number };
}

export interface MockCallRecord {
  model: string;
  max_tokens: number;
  system: string;
  messages: MockMessage[];
  tools: ToolDefinition[];
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Mock Anthropic Client
// ---------------------------------------------------------------------------

export class MockAnthropicClient {
  private responses: MockResponse[] = [];
  private responseIndex = 0;
  private callHistory: MockCallRecord[] = [];
  private defaultResponse: MockResponse = {
    id: 'msg_mock_default',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'Default mock response' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
  };

  addResponse(response: Partial<MockResponse>): this {
    this.responses.push({
      id: `msg_mock_${this.responses.length}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Mock response' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
      ...response,
    });
    return this;
  }

  addTextResponse(text: string, stopReason: MockResponse['stop_reason'] = 'end_turn'): this {
    return this.addResponse({
      content: [{ type: 'text', text }],
      stop_reason: stopReason,
    });
  }

  addToolUseResponse(
    toolName: string,
    toolInput: Record<string, unknown>,
    toolId = `tool_${Date.now()}`
  ): this {
    return this.addResponse({
      content: [{ type: 'tool_use', id: toolId, name: toolName, input: toolInput }],
      stop_reason: 'tool_use',
    });
  }

  addMultiToolResponse(
    tools: Array<{ name: string; input: Record<string, unknown>; id?: string }>
  ): this {
    const content: MockContentBlock[] = tools.map((tool, index) => ({
      type: 'tool_use' as const,
      id: tool.id ?? `tool_${index}_${Date.now()}`,
      name: tool.name,
      input: tool.input,
    }));
    return this.addResponse({ content, stop_reason: 'tool_use' });
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
      stop_reason: 'tool_use',
    });
  }

  setDefaultResponse(response: Partial<MockResponse>): this {
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

  messages = {
    create: async (params: {
      model: string;
      max_tokens: number;
      system: string;
      messages: MockMessage[];
      tools?: ToolDefinition[];
    }): Promise<MockResponse> => {
      // Record the call
      this.callHistory.push({
        model: params.model,
        max_tokens: params.max_tokens,
        system: params.system,
        messages: params.messages,
        tools: params.tools ?? [],
        timestamp: Date.now(),
      });

      // Return next response from queue or default
      if (this.responseIndex < this.responses.length) {
        const response = this.responses[this.responseIndex];
        this.responseIndex++;
        return response!;
      }

      return this.defaultResponse;
    },
  };
}

// ---------------------------------------------------------------------------
// Response Builders
// ---------------------------------------------------------------------------

export function createTextResponse(text: string): MockResponse {
  return {
    id: `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

export function createToolUseResponse(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolId = `tool_${Date.now()}`
): MockResponse {
  return {
    id: `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'tool_use', id: toolId, name: toolName, input: toolInput }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

export function createMaxTokensResponse(text: string): MockResponse {
  return {
    id: `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    stop_reason: 'max_tokens',
    usage: { input_tokens: 100, output_tokens: 8192 },
  };
}

// ---------------------------------------------------------------------------
// Factory Function
// ---------------------------------------------------------------------------

export function createMockAnthropicClient(): MockAnthropicClient {
  return new MockAnthropicClient();
}
