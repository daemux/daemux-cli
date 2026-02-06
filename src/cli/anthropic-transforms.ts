/**
 * Anthropic SDK Transformation Utilities
 * Converts between internal types and Anthropic SDK types.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { LLMCredentials, LLMChatOptions } from '../core/plugin-api-types';
import type { ToolDefinition } from '../core/types';

const CLAUDE_CODE_VERSION = '2.1.2';

// ---------------------------------------------------------------------------
// Client Options
// ---------------------------------------------------------------------------

/**
 * Build Anthropic SDK constructor options from LLM credentials.
 * For token-based auth, sets authToken and required headers.
 * For API key auth, passes the key directly.
 *
 * When using token auth, apiKey is set to empty string because the SDK
 * requires the field to be a string, but it is unused when authToken is set.
 */
export function buildClientOptions(
  credentials: LLMCredentials
): ConstructorParameters<typeof Anthropic>[0] {
  if (credentials.type !== 'token') {
    return { apiKey: credentials.value };
  }

  return {
    apiKey: '',
    authToken: credentials.value,
    defaultHeaders: {
      'accept': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
      'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
      'user-agent': `claude-cli/${CLAUDE_CODE_VERSION} (external, cli)`,
      'x-app': 'cli',
    },
  };
}

// ---------------------------------------------------------------------------
// Tool Conversion
// ---------------------------------------------------------------------------

export function toAnthropicTools(tools?: ToolDefinition[]): Anthropic.Tool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
  }));
}

// ---------------------------------------------------------------------------
// Message Conversion
// ---------------------------------------------------------------------------

export function toAnthropicMessages(
  messages: LLMChatOptions['messages']
): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content as Anthropic.MessageParam['content'],
  }));
}
