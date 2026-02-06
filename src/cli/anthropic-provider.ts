/**
 * Anthropic LLM Provider
 * Implements the LLMProvider interface using @anthropic-ai/sdk
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMProvider,
  LLMCredentials,
  LLMModel,
  LLMProviderCapabilities,
  LLMChatOptions,
  LLMChatChunk,
  LLMChatResponse,
} from '../core/plugin-api-types';
import { getLogger } from '../infra/logger';
import { buildClientOptions, toAnthropicTools, toAnthropicMessages } from './anthropic-transforms';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROVIDER_ID = 'anthropic';
const PROVIDER_NAME = 'Anthropic';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

const MODELS: LLMModel[] = [
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', contextWindow: 200000, maxOutputTokens: 32000 },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', contextWindow: 200000, maxOutputTokens: 16384 },
  { id: 'claude-haiku-3-5-20250514', name: 'Claude Haiku 3.5', contextWindow: 200000, maxOutputTokens: 8192 },
];

const CAPABILITIES: LLMProviderCapabilities = {
  streaming: true,
  toolUse: true,
  vision: true,
  maxContextWindow: 200000,
};

// ---------------------------------------------------------------------------
// Anthropic Provider Class
// ---------------------------------------------------------------------------

export class AnthropicProvider implements LLMProvider {
  readonly id = PROVIDER_ID;
  readonly name = PROVIDER_NAME;
  readonly capabilities = CAPABILITIES;

  private client: Anthropic | null = null;
  private ready = false;

  async initialize(credentials: LLMCredentials): Promise<void> {
    this.client = new Anthropic(buildClientOptions(credentials));
    this.ready = true;
    getLogger().debug('Anthropic provider initialized');
  }

  isReady(): boolean {
    return this.ready;
  }

  async verifyCredentials(
    credentials: LLMCredentials
  ): Promise<{ valid: boolean; error?: string }> {
    try {
      const client = new Anthropic(buildClientOptions(credentials));
      await client.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      });
      return { valid: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('authentication') || msg.includes('401')) {
        return { valid: false, error: 'Invalid credentials' };
      }
      return { valid: true };
    }
  }

  listModels(): LLMModel[] {
    return [...MODELS];
  }

  getDefaultModel(): string {
    return DEFAULT_MODEL;
  }

  async *chat(options: LLMChatOptions): AsyncGenerator<LLMChatChunk> {
    if (!this.client) throw new Error('Provider not initialized');

    const stream = this.client.messages.stream({
      model: options.model,
      max_tokens: options.maxTokens ?? 8192,
      system: options.systemPrompt,
      messages: toAnthropicMessages(options.messages),
      tools: toAnthropicTools(options.tools),
    });

    // Stream text deltas in real time for responsive output
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'text', content: event.delta.text };
      }
    }

    // Emit tool_use blocks with complete input from final message
    const finalMessage = await stream.finalMessage();
    for (const block of finalMessage.content) {
      if (block.type === 'tool_use') {
        yield {
          type: 'tool_use',
          toolUseId: block.id,
          toolName: block.name,
          toolInput: block.input as Record<string, unknown>,
        };
      }
    }

    yield {
      type: 'done',
      stopReason: finalMessage.stop_reason as LLMChatChunk['stopReason'],
      usage: {
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
      },
    };
  }

  async compactionChat(options: LLMChatOptions): Promise<LLMChatResponse> {
    if (!this.client) throw new Error('Provider not initialized');

    const response = await this.client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens ?? 2000,
      system: options.systemPrompt,
      messages: toAnthropicMessages(options.messages),
    });

    const content = response.content
      .filter((b): b is Anthropic.TextBlock | Anthropic.ToolUseBlock =>
        b.type === 'text' || b.type === 'tool_use'
      )
      .map((block): LLMChatResponse['content'][number] => {
        if (block.type === 'text') {
          return { type: 'text', text: block.text };
        }
        return {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        };
      });

    return {
      content,
      stopReason: response.stop_reason as LLMChatResponse['stopReason'],
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  async shutdown(): Promise<void> {
    this.client = null;
    this.ready = false;
    getLogger().debug('Anthropic provider shut down');
  }
}

// ---------------------------------------------------------------------------
// Factory Helper
// ---------------------------------------------------------------------------

export function createAnthropicProvider(): AnthropicProvider {
  return new AnthropicProvider();
}
