/**
 * Compaction Helpers
 * Module-level functions for conversation summarization and compaction stats.
 */

import type { Message } from '../types';
import type { Database } from '../../infra/database';
import type { EventBus } from '../event-bus';
import type { LLMProvider } from '../plugin-api-types';
import { getLogger } from '../../infra/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPACTION_PROMPT = `Summarize the following conversation while preserving:
1. Key facts and decisions made
2. Current task state and progress
3. Important user preferences or context
4. Any errors or issues that need to be remembered

Be concise but complete. This summary will replace the conversation history.`;

const COMPACTION_MODEL = 'claude-haiku-3-5-20250514';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Summarize a list of messages via the LLM provider and replace
 * the session's message history with the summary.
 */
export async function summarizeAndReplace(
  provider: LLMProvider,
  db: Database,
  sessionId: string,
  messages: Message[],
  addMessage: (
    sessionId: string,
    role: Message['role'],
    content: Message['content'],
  ) => Message,
): Promise<string> {
  const conversationText = messages
    .map((m) => {
      const content = typeof m.content === 'string'
        ? m.content
        : JSON.stringify(m.content);
      return `${m.role.toUpperCase()}: ${content}`;
    })
    .join('\n\n');

  const response = await provider.compactionChat({
    model: COMPACTION_MODEL,
    messages: [{ role: 'user', content: conversationText }],
    maxTokens: 2000,
    systemPrompt: COMPACTION_PROMPT,
  });

  const summaryBlock = response.content.find((b) => b.type === 'text');
  const summary = summaryBlock?.text ?? '';

  db.messages.deleteSession(sessionId);
  addMessage(sessionId, 'system', `[Previous conversation summary]\n\n${summary}`);

  return summary;
}

/**
 * Persist compaction statistics to the session record and emit
 * the session:compact event.
 */
export async function updateCompactionStats(
  db: Database,
  eventBus: EventBus,
  sessionId: string,
  beforeTokens: number,
  afterTokens: number,
): Promise<void> {
  const session = await db.sessions.get(sessionId);
  if (session) {
    await db.sessions.update(sessionId, {
      compactionCount: session.compactionCount + 1,
      lastActivity: Date.now(),
    });
  }

  await eventBus.emit('session:compact', { sessionId, beforeTokens, afterTokens });

  getLogger().info('Session compacted', {
    sessionId, beforeTokens, afterTokens,
    reduction: `${Math.round((1 - afterTokens / beforeTokens) * 100)}%`,
  });
}

/**
 * Validate message chain integrity for a session.
 */
export function validateChain(db: Database, sessionId: string): { valid: boolean; brokenAt?: string } {
  return db.messages.validateChain(sessionId);
}

/**
 * Update session activity timestamp and total tokens used.
 */
export async function updateActivity(db: Database, sessionId: string, tokensUsed: number): Promise<void> {
  const session = await db.sessions.get(sessionId);
  if (session) {
    await db.sessions.update(sessionId, {
      lastActivity: Date.now(),
      totalTokensUsed: session.totalTokensUsed + tokensUsed,
    });
  }
}
