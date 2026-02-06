/**
 * Agentic Loop Helpers
 * Module-level utility functions for the agentic loop.
 */

import type { LLMProvider } from '../plugin-api-types';
import type { LoopConfig, LoopResult, ToolCallRecord } from './types';
import type { SessionPersistence } from '../session-persistence';
import type { Database } from '../../infra/database';
import { getProviderManager, hasProviderManager } from '../provider-manager';
import { getLogger } from '../../infra/logger';

export function resolveProvider(directProvider?: LLMProvider): LLMProvider {
  if (directProvider) return directProvider;
  if (hasProviderManager()) {
    const active = getProviderManager().getActiveProvider();
    if (!active) throw new Error('No active LLM provider. Call setActiveProvider first.');
    return active;
  }
  throw new Error(
    'No LLM provider available. Either pass a provider directly, ' +
    'or initialize ProviderManager and set an active provider.'
  );
}

/** @internal Exported for testing only */
export function defaultSystemPrompt(loopConfig: LoopConfig): string {
  return loopConfig.agent
    ? loopConfig.agent.systemPrompt
    : 'You are a helpful AI assistant. Use the available tools to help the user.';
}

export async function persistTurn(
  persistence: SessionPersistence | null, db: Database, sessionId: string,
): Promise<void> {
  if (!persistence) return;
  try {
    const messages = db.messages.list(sessionId);
    await persistence.appendTurn(sessionId, messages);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().warn('Failed to persist session turn', { sessionId, error: msg });
  }
}

export async function buildResult(
  state: {
    sessionId: string;
    loopConfig: LoopConfig;
    totalInputTokens: number;
    totalOutputTokens: number;
    allToolCalls: ToolCallRecord[];
    stopReason: LoopResult['stopReason'];
    finalResponse: string;
    compacted: boolean;
    startTime: number;
    iterations: number;
  },
  db: Database,
  persistence: SessionPersistence | null,
  running: { value: boolean },
  currentSessionId: { value: string | null },
): Promise<LoopResult> {
  await persistTurn(persistence, db, state.sessionId);
  const { updateActivity } = await import('./compaction');
  await updateActivity(
    db, state.sessionId, state.totalInputTokens + state.totalOutputTokens,
  );
  running.value = false;
  currentSessionId.value = null;

  if (state.loopConfig.onStream) {
    state.loopConfig.onStream({ type: 'done', stopReason: state.stopReason });
  }
  const durationMs = Date.now() - state.startTime;
  getLogger().info('Loop completed', {
    sessionId: state.sessionId, iterations: state.iterations,
    stopReason: state.stopReason, inputTokens: state.totalInputTokens,
    outputTokens: state.totalOutputTokens, toolCalls: state.allToolCalls.length, durationMs,
  });

  return {
    response: state.finalResponse, sessionId: state.sessionId,
    tokensUsed: { input: state.totalInputTokens, output: state.totalOutputTokens },
    toolCalls: state.allToolCalls, stopReason: state.stopReason, durationMs,
    compacted: state.compacted,
  };
}
