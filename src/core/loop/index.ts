/**
 * Agentic Loop - Main Orchestrator
 * Loop until stop_reason !== "tool_use"
 */

import { randomUUID } from 'crypto';
import type { Config } from '../types';
import type { Database } from '../../infra/database';
import type { EventBus } from '../event-bus';
import type { LLMProvider } from '../plugin-api-types';
import type {
  LoopConfig,
  LoopResult,
  ToolUseBlock,
  ContentBlock,
  ToolCallRecord,
} from './types';
import { ContextBuilder } from './context';
import { ToolExecutor } from './executor';
import { BUILTIN_TOOLS } from './tools';
import { callLLMAPI } from './api-caller';
import { getLogger } from '../../infra/logger';
import type { SessionPersistence } from '../session-persistence';
import { resolveProvider, defaultSystemPrompt, persistTurn, buildResult } from './helpers';

// Re-export types and sub-modules
export * from './types';
export { BUILTIN_TOOLS, registerToolExecutor } from './tools';
export { ContextBuilder } from './context';
export { ToolExecutor } from './executor';
export { defaultSystemPrompt } from './helpers';
export { createAgenticLoop, getAgenticLoop } from './factory';

// ---------------------------------------------------------------------------
// Internal State for a Single Loop Execution
// ---------------------------------------------------------------------------

interface LoopState {
  sessionId: string;
  systemPrompt: string;
  toolExecutor: ToolExecutor;
  loopConfig: LoopConfig;
  allToolCalls: ToolCallRecord[];
  totalInputTokens: number;
  totalOutputTokens: number;
  compacted: boolean;
  finalResponse: string;
  stopReason: LoopResult['stopReason'];
  iterations: number;
  startTime: number;
}

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
  private persistence: SessionPersistence | null;
  private running = false;
  private interrupted = false;
  private currentSessionId: string | null = null;

  constructor(options: {
    db: Database;
    eventBus: EventBus;
    config: Config;
    provider?: LLMProvider;
    persistence?: SessionPersistence;
    /** @deprecated Use provider instead */
    apiKey?: string;
    /** @deprecated Use provider instead */
    credentials?: Credentials;
  }) {
    this.db = options.db;
    this.eventBus = options.eventBus;
    this.config = options.config;
    this.persistence = options.persistence ?? null;
    this.provider = resolveProvider(options.provider);
    this.contextBuilder = new ContextBuilder({
      db: this.db, eventBus: this.eventBus, config: this.config, provider: this.provider,
    });
  }

  async run(message: string, loopConfig: LoopConfig = {}): Promise<LoopResult> {
    const state = await this.initializeRun(message, loopConfig);

    while (!this.interrupted) {
      state.iterations++;
      const shouldBreak = await this.executeIteration(state);
      if (shouldBreak) break;
    }

    const running = { value: this.running };
    const currentSessionId = { value: this.currentSessionId };
    const result = await buildResult(state, this.db, this.persistence, running, currentSessionId);
    this.running = running.value;
    this.currentSessionId = currentSessionId.value;
    return result;
  }

  async resume(
    sessionId: string, message: string, loopConfig: LoopConfig = {},
  ): Promise<LoopResult> {
    return this.run(message, { ...loopConfig, sessionId });
  }

  getSession(): string | null { return this.currentSessionId; }
  interrupt(): void { this.interrupted = true; }
  isRunning(): boolean { return this.running; }
  getProvider(): LLMProvider { return this.provider; }

  async getContextInfo(): Promise<{
    sessionId: string | null;
    effectiveContextWindow: number;
    compactionThreshold: number;
    systemPromptText: string;
    agentContextText: string | null;
    messageTokens: number;
    messageCount: number;
  }> {
    const basePrompt = defaultSystemPrompt({});
    const systemPromptText = await this.contextBuilder.buildSystemPrompt(basePrompt);
    const agentContextText = await this.contextBuilder.loadAgentContext();
    let messageTokens = 0;
    let messageCount = 0;
    if (this.currentSessionId) {
      messageTokens = this.db.messages.getTokenCount(this.currentSessionId);
      messageCount = this.db.messages.list(this.currentSessionId).length;
    }
    return {
      sessionId: this.currentSessionId,
      effectiveContextWindow: this.config.effectiveContextWindow,
      compactionThreshold: this.config.compactionThreshold,
      systemPromptText,
      agentContextText,
      messageTokens,
      messageCount,
    };
  }

  // ---------------------------------------------------------------------------
  // Private: Run Initialization
  // ---------------------------------------------------------------------------

  private async initializeRun(message: string, loopConfig: LoopConfig): Promise<LoopState> {
    this.running = true;
    this.interrupted = false;
    const startTime = Date.now();
    const basePrompt = loopConfig.systemPrompt ?? defaultSystemPrompt(loopConfig);
    const systemPrompt = await this.contextBuilder.buildSystemPrompt(basePrompt);
    const tools = loopConfig.tools ?? BUILTIN_TOOLS;
    const toolExecutor = new ToolExecutor({
      eventBus: this.eventBus, allowedTools: tools.map(t => t.name),
    });

    if (loopConfig.toolExecutors) {
      for (const [name, executor] of loopConfig.toolExecutors) {
        toolExecutor.registerExecutor(name, executor);
      }
    }

    const context = await this.contextBuilder.build(
      loopConfig.sessionId ?? randomUUID(), systemPrompt,
    );
    this.currentSessionId = context.sessionId;

    if (this.contextBuilder.needsCompaction(context.tokenCount)) {
      await this.contextBuilder.compact(context.sessionId, systemPrompt);
    }
    const lastMsg = context.messages[context.messages.length - 1];
    this.contextBuilder.addMessage(context.sessionId, 'user', message, lastMsg?.uuid ?? null);

    return {
      sessionId: context.sessionId, systemPrompt, toolExecutor, loopConfig,
      allToolCalls: [], totalInputTokens: 0, totalOutputTokens: 0,
      compacted: false, finalResponse: '', stopReason: 'end_turn', iterations: 0, startTime,
    };
  }

  // ---------------------------------------------------------------------------
  // Private: Single Iteration (calls API, handles tool use)
  // ---------------------------------------------------------------------------

  private async executeIteration(state: LoopState): Promise<boolean> {
    const timeoutMs = state.loopConfig.timeoutMs ?? this.config.turnTimeoutMs;
    if (Date.now() - state.startTime > timeoutMs) {
      state.stopReason = 'timeout';
      return true;
    }

    const messages = this.db.messages.list(state.sessionId);
    const currentTokens = this.db.messages.getTokenCount(state.sessionId);
    if (this.contextBuilder.atLimit(currentTokens)) {
      getLogger().warn('Token limit reached, compacting', { sessionId: state.sessionId });
      await this.contextBuilder.compact(state.sessionId, state.systemPrompt);
      state.compacted = true;
      return false;
    }

    const tools = state.loopConfig.tools ?? BUILTIN_TOOLS;
    const apiMessages = this.contextBuilder.toAPIMessages(messages);
    const response = await callLLMAPI(
      this.provider, this.config, state.systemPrompt, apiMessages, tools,
      state.loopConfig.onStream, { eventBus: this.eventBus },
    );
    state.totalInputTokens += response.usage.input_tokens;
    state.totalOutputTokens += response.usage.output_tokens;

    const lastUserMsg = messages[messages.length - 1];
    this.contextBuilder.addMessage(
      state.sessionId, 'assistant', response.content,
      lastUserMsg?.uuid ?? null, response.usage.output_tokens,
    );

    const textBlocks = response.content.filter(
      (b): b is { type: 'text'; text: string } => b.type === 'text',
    );
    const toolUses = response.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
    state.finalResponse = textBlocks.map(b => b.text).join('\n');

    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      state.stopReason = response.stop_reason === 'max_tokens' ? 'max_tokens' : 'end_turn';
      return true;
    }

    await this.executeToolsAndStream(state, toolUses);
    state.stopReason = 'tool_use';
    return false;
  }

  private async executeToolsAndStream(state: LoopState, toolUses: ToolUseBlock[]): Promise<void> {
    if (state.loopConfig.onStream) {
      for (const tu of toolUses) {
        state.loopConfig.onStream({ type: 'tool_start', toolUseId: tu.id, name: tu.name });
      }
    }

    const toolResults = await state.toolExecutor.executeAll(toolUses);
    state.allToolCalls.push(...toolResults);

    if (state.loopConfig.onStream) {
      for (let i = 0; i < toolResults.length; i++) {
        const r = toolResults[i]!;
        const tu = toolUses[i]!;
        state.loopConfig.onStream({
          type: 'tool_result', toolUseId: tu.id, result: r.result, isError: r.isError,
        });
      }
    }

    const blocks = state.toolExecutor.toContentBlocks(toolResults, toolUses);
    const aMsg = this.db.messages.list(state.sessionId).pop();
    this.contextBuilder.addMessage(
      state.sessionId, 'user', blocks as unknown as ContentBlock[], aMsg?.uuid ?? null,
    );
    await persistTurn(this.persistence, this.db, state.sessionId);
  }
}
