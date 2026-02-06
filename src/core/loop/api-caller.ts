/**
 * API Caller - Handles LLM API streaming and response assembly
 * Includes exponential backoff retry for rate-limit errors.
 */

import type { ToolDefinition } from '../types';
import type { LLMProvider, LLMChatOptions } from '../plugin-api-types';
import type { Config } from '../types';
import type { StreamChunk, ContentBlock, APIMessage } from './types';
import type { EventBus } from '../event-bus';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKOFF_DELAYS = [2000, 4000, 8000, 16000, 30000];
const MAX_RETRIES = 5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface APICallResult {
  content: ContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | null;
  usage: { input_tokens: number; output_tokens: number };
}

export interface APICallerOptions {
  eventBus?: EventBus;
}

// ---------------------------------------------------------------------------
// Rate Limit Detection
// ---------------------------------------------------------------------------

function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('overloaded')) return true;

  const statusErr = err as Error & { status?: number; statusCode?: number };
  if (statusErr.status === 429 || statusErr.statusCode === 429) return true;

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// API Caller Function
// ---------------------------------------------------------------------------

export async function callLLMAPI(
  provider: LLMProvider,
  config: Config,
  systemPrompt: string,
  messages: APIMessage[],
  tools: ToolDefinition[],
  onStream?: (chunk: StreamChunk) => void,
  options?: APICallerOptions
): Promise<APICallResult> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await executeCall(provider, config, systemPrompt, messages, tools, onStream);
    } catch (err) {
      if (isRateLimitError(err) && attempt < MAX_RETRIES) {
        const delay = BACKOFF_DELAYS[attempt] ?? 30000;
        if (options?.eventBus) {
          void options.eventBus.emit('error', {
            error: new Error(`Rate limit hit, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`),
            context: 'rate-limit-retry',
          });
        }
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }

  throw new Error('Rate limit retries exhausted');
}

async function executeCall(
  provider: LLMProvider,
  config: Config,
  systemPrompt: string,
  messages: APIMessage[],
  tools: ToolDefinition[],
  onStream?: (chunk: StreamChunk) => void
): Promise<APICallResult> {
  const model = config.model === 'default'
    ? provider.getDefaultModel()
    : config.model;

  const chatOptions: LLMChatOptions = {
    model,
    messages: messages.map(m => ({
      role: m.role,
      content: m.content,
    })),
    tools,
    maxTokens: config.maxTokens,
    systemPrompt,
  };

  const contentBlocks: ContentBlock[] = [];
  let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | null = null;
  let usage = { input_tokens: 0, output_tokens: 0 };
  let currentTextBlock: { type: 'text'; text: string } | null = null;

  const flushTextBlock = (): void => {
    if (currentTextBlock) {
      contentBlocks.push(currentTextBlock);
      currentTextBlock = null;
    }
  };

  for await (const chunk of provider.chat(chatOptions)) {
    if (chunk.type === 'text' && chunk.content) {
      if (!currentTextBlock) {
        currentTextBlock = { type: 'text', text: '' };
      }
      currentTextBlock.text += chunk.content;
      onStream?.({ type: 'text', content: chunk.content });
    } else if (chunk.type === 'tool_use') {
      flushTextBlock();
      contentBlocks.push({
        type: 'tool_use',
        id: chunk.toolUseId!,
        name: chunk.toolName!,
        input: chunk.toolInput!,
      });
    } else if (chunk.type === 'done') {
      flushTextBlock();
      stopReason = chunk.stopReason ?? null;
      if (chunk.usage) {
        usage = {
          input_tokens: chunk.usage.inputTokens,
          output_tokens: chunk.usage.outputTokens,
        };
      }
    }
  }

  return {
    content: contentBlocks,
    stop_reason: stopReason,
    usage,
  };
}
