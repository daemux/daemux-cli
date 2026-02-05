/**
 * Agentic Loop - Main Orchestrator
 * Loop until stop_reason !== "tool_use"
 */

import { randomUUID } from 'crypto';
import type { Config, ToolDefinition } from '../types';
import type { Database } from '../../infra/database';
import type { EventBus } from '../event-bus';
import type { LLMProvider, LLMCredentials, LLMChatOptions } from '../plugin-api-types';
import type {
  LoopConfig,
  LoopResult,
  StreamChunk,
  ToolUseBlock,
  ContentBlock,
  APIMessage,
  ToolCallRecord,
} from './types';
import { ContextBuilder } from './context';
import { ToolExecutor } from './executor';
import { BUILTIN_TOOLS } from './tools';
import { getLogger } from '../../infra/logger';
import { getProviderManager, hasProviderManager } from '../provider-manager';

// Re-export types
export * from './types';
export { BUILTIN_TOOLS, registerToolExecutor } from './tools';
export { ContextBuilder } from './context';
export { ToolExecutor } from './executor';

// ---------------------------------------------------------------------------
// Agentic Loop Class
// ---------------------------------------------------------------------------

/** @deprecated Use LLMCredentials from plugin-api-types instead */
interface Credentials {
  type: 'token' | 'api_key';
  value: string;
}

export class AgenticLoop {
  private db: Database;
  private eventBus: EventBus;
  private config: Config;
  private provider: LLMProvider;
  private contextBuilder: ContextBuilder;
  private running = false;
  private interrupted = false;
  private currentSessionId: string | null = null;

  constructor(options: {
    db: Database;
    eventBus: EventBus;
    config: Config;
    /** Direct provider injection (preferred) */
    provider?: LLMProvider;
    /** @deprecated Use provider instead - will use ProviderManager if available */
    apiKey?: string;
    /** @deprecated Use provider instead - will use ProviderManager if available */
    credentials?: Credentials;
  }) {
    this.db = options.db;
    this.eventBus = options.eventBus;
    this.config = options.config;

    // Resolve provider: direct injection > ProviderManager > error
    if (options.provider) {
      this.provider = options.provider;
    } else if (hasProviderManager()) {
      const activeProvider = getProviderManager().getActiveProvider();
      if (!activeProvider) {
        throw new Error('No active LLM provider. Call setActiveProvider first.');
      }
      this.provider = activeProvider;
    } else {
      throw new Error(
        'No LLM provider available. Either pass a provider directly, ' +
        'or initialize ProviderManager and set an active provider.'
      );
    }

    this.contextBuilder = new ContextBuilder({
      db: this.db,
      eventBus: this.eventBus,
      config: this.config,
      provider: this.provider,
    });
  }

  /**
   * Run the agentic loop with a message
   */
  async run(message: string, loopConfig: LoopConfig = {}): Promise<LoopResult> {
    const startTime = Date.now();
    const requestedSessionId = loopConfig.sessionId ?? randomUUID();
    this.running = true;
    this.interrupted = false;

    const systemPrompt = loopConfig.systemPrompt ?? this.buildSystemPrompt(loopConfig);
    const tools = loopConfig.tools ?? BUILTIN_TOOLS;
    const maxIterations = loopConfig.maxIterations ?? 100;
    const timeoutMs = loopConfig.timeoutMs ?? this.config.turnTimeoutMs;

    // Initialize tool executor
    const toolExecutor = new ToolExecutor({
      eventBus: this.eventBus,
      allowedTools: tools.map(t => t.name),
    });

    // Build context - this may create a new session with a different ID
    const context = await this.contextBuilder.build(requestedSessionId, systemPrompt);
    // Use the actual session ID from context (may differ if session was created)
    const sessionId = context.sessionId;
    this.currentSessionId = sessionId;

    // Check for compaction before starting
    if (this.contextBuilder.needsCompaction(context.tokenCount)) {
      await this.contextBuilder.compact(sessionId, systemPrompt);
    }

    // Add user message
    const lastMsg = context.messages[context.messages.length - 1];
    this.contextBuilder.addMessage(
      sessionId,
      'user',
      message,
      lastMsg?.uuid ?? null
    );

    // Prepare result tracking
    const allToolCalls: ToolCallRecord[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let compacted = false;
    let finalResponse = '';
    let stopReason: LoopResult['stopReason'] = 'end_turn';
    let iterations = 0;

    // Main loop
    while (iterations < maxIterations && !this.interrupted) {
      iterations++;

      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        stopReason = 'timeout';
        break;
      }

      // Get current messages
      const messages = this.db.messages.list(sessionId);
      const apiMessages = this.contextBuilder.toAPIMessages(messages);

      // Check token limit
      const currentTokens = this.db.messages.getTokenCount(sessionId);
      if (this.contextBuilder.atLimit(currentTokens)) {
        getLogger().warn('Token limit reached, compacting', { sessionId });
        await this.contextBuilder.compact(sessionId, systemPrompt);
        compacted = true;
        continue;
      }

      // Call API
      const response = await this.callAPI(
        systemPrompt,
        apiMessages,
        tools,
        loopConfig.onStream
      );

      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      // Add assistant message
      const lastUserMsg = messages[messages.length - 1];
      this.contextBuilder.addMessage(
        sessionId,
        'assistant',
        response.content,
        lastUserMsg?.uuid ?? null,
        response.usage.output_tokens
      );

      // Extract text and tool uses
      const textBlocks = response.content.filter(b => b.type === 'text');
      const toolUses = response.content.filter(
        (b): b is ToolUseBlock => b.type === 'tool_use'
      );

      // Emit text to stream
      if (loopConfig.onStream) {
        for (const block of textBlocks) {
          if (block.type === 'text') {
            loopConfig.onStream({ type: 'text', content: block.text });
          }
        }
      }

      finalResponse = textBlocks
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map(b => b.text)
        .join('\n');

      // Check stop reason
      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
        stopReason = response.stop_reason === 'max_tokens' ? 'max_tokens' : 'end_turn';
        break;
      }

      // Execute tools
      if (loopConfig.onStream) {
        for (const toolUse of toolUses) {
          loopConfig.onStream({
            type: 'tool_start',
            toolUseId: toolUse.id,
            name: toolUse.name,
          });
        }
      }

      const toolResults = await toolExecutor.executeAll(toolUses);
      allToolCalls.push(...toolResults);

      // Stream tool results
      if (loopConfig.onStream) {
        for (const result of toolResults) {
          const toolUse = toolUses.find(t => t.name === result.name);
          if (toolUse) {
            loopConfig.onStream({
              type: 'tool_result',
              toolUseId: toolUse.id,
              result: result.result,
              isError: result.isError,
            });
          }
        }
      }

      // Add tool results as user message
      const toolResultBlocks = toolExecutor.toContentBlocks(toolResults, toolUses);
      const assistantMsg = this.db.messages.list(sessionId).pop();
      this.contextBuilder.addMessage(
        sessionId,
        'user',
        toolResultBlocks as unknown as ContentBlock[],
        assistantMsg?.uuid ?? null
      );

      stopReason = 'tool_use';
    }

    // Update session stats
    await this.contextBuilder.updateActivity(
      sessionId,
      totalInputTokens + totalOutputTokens
    );

    this.running = false;
    this.currentSessionId = null;

    // Emit done event
    if (loopConfig.onStream) {
      loopConfig.onStream({ type: 'done', stopReason });
    }

    const durationMs = Date.now() - startTime;

    getLogger().info('Loop completed', {
      sessionId,
      iterations,
      stopReason,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      toolCalls: allToolCalls.length,
      durationMs,
    });

    return {
      response: finalResponse,
      sessionId,
      tokensUsed: {
        input: totalInputTokens,
        output: totalOutputTokens,
      },
      toolCalls: allToolCalls,
      stopReason,
      durationMs,
      compacted,
    };
  }

  /**
   * Resume a session
   */
  async resume(
    sessionId: string,
    message: string,
    loopConfig: LoopConfig = {}
  ): Promise<LoopResult> {
    return this.run(message, { ...loopConfig, sessionId });
  }

  /**
   * Get current session ID
   */
  getSession(): string | null {
    return this.currentSessionId;
  }

  /**
   * Interrupt current execution
   */
  interrupt(): void {
    this.interrupted = true;
  }

  /**
   * Check if loop is running
   */
  isRunning(): boolean {
    return this.running;
  }

  private async callAPI(
    systemPrompt: string,
    messages: APIMessage[],
    tools: ToolDefinition[],
    onStream?: (chunk: StreamChunk) => void
  ): Promise<{
    content: ContentBlock[];
    stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | null;
    usage: { input_tokens: number; output_tokens: number };
  }> {
    // Resolve model: use config model, or 'default' to let provider decide
    const model = this.config.model === 'default'
      ? this.provider.getDefaultModel()
      : this.config.model;

    const chatOptions: LLMChatOptions = {
      model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      tools,
      maxTokens: this.config.maxTokens,
      systemPrompt,
    };

    // Collect streaming response into final result
    const contentBlocks: ContentBlock[] = [];
    let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | null = null;
    let usage = { input_tokens: 0, output_tokens: 0 };
    let currentTextBlock: { type: 'text'; text: string } | null = null;

    for await (const chunk of this.provider.chat(chatOptions)) {
      if (chunk.type === 'text' && chunk.content) {
        // Accumulate text content
        if (!currentTextBlock) {
          currentTextBlock = { type: 'text', text: '' };
        }
        currentTextBlock.text += chunk.content;

        // Stream to callback if provided
        if (onStream) {
          onStream({ type: 'text', content: chunk.content });
        }
      } else if (chunk.type === 'tool_use') {
        // Finalize any pending text block
        if (currentTextBlock) {
          contentBlocks.push(currentTextBlock);
          currentTextBlock = null;
        }
        // Add tool use block
        contentBlocks.push({
          type: 'tool_use',
          id: chunk.toolUseId!,
          name: chunk.toolName!,
          input: chunk.toolInput!,
        });
      } else if (chunk.type === 'done') {
        // Finalize any pending text block
        if (currentTextBlock) {
          contentBlocks.push(currentTextBlock);
          currentTextBlock = null;
        }
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

  private buildSystemPrompt(loopConfig: LoopConfig): string {
    return loopConfig.agent
      ? loopConfig.agent.systemPrompt
      : 'You are a helpful AI assistant. Use the available tools to help the user.';
  }

  /**
   * Get the current provider
   */
  getProvider(): LLMProvider {
    return this.provider;
  }
}

// ---------------------------------------------------------------------------
// Global Loop Instance
// ---------------------------------------------------------------------------

let globalLoop: AgenticLoop | null = null;

export function createAgenticLoop(options: {
  db: Database;
  eventBus: EventBus;
  config: Config;
  /** Direct provider injection (preferred) */
  provider?: LLMProvider;
  /** @deprecated Use provider instead */
  apiKey?: string;
  /** @deprecated Use provider instead */
  credentials?: Credentials;
}): AgenticLoop {
  globalLoop = new AgenticLoop(options);
  return globalLoop;
}

export function getAgenticLoop(): AgenticLoop {
  if (!globalLoop) {
    throw new Error('Agentic loop not initialized. Call createAgenticLoop first.');
  }
  return globalLoop;
}
