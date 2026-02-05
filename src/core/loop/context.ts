/**
 * Context Builder and Compaction
 * Manages conversation context and token-aware summarization
 */

import type { Message, Config } from '../types';
import type { Database } from '../../infra/database';
import type { EventBus } from '../event-bus';
import type { LLMProvider } from '../plugin-api-types';
import type { SessionContext, APIMessage, ContentBlock } from './types';
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

// Model used for compaction (lightweight, fast)
const COMPACTION_MODEL = 'claude-haiku-3-5-20250514';

// ---------------------------------------------------------------------------
// Context Builder Class
// ---------------------------------------------------------------------------

export class ContextBuilder {
  private db: Database;
  private eventBus: EventBus;
  private config: Config;
  private provider: LLMProvider;

  constructor(options: {
    db: Database;
    eventBus: EventBus;
    config: Config;
    provider: LLMProvider;
  }) {
    this.db = options.db;
    this.eventBus = options.eventBus;
    this.config = options.config;
    this.provider = options.provider;
  }

  /**
   * Build context for a session
   */
  async build(
    sessionId: string,
    systemPrompt: string
  ): Promise<SessionContext> {
    // Get or create session
    let session = await this.db.sessions.get(sessionId);
    if (!session) {
      session = await this.db.sessions.create({
        createdAt: Date.now(),
        lastActivity: Date.now(),
        compactionCount: 0,
        totalTokensUsed: 0,
        queueMode: this.config.queueMode,
        flags: {},
      });
    }

    // Load messages
    const messages = this.db.messages.list(sessionId);
    const tokenCount = this.db.messages.getTokenCount(sessionId);

    return {
      sessionId: session.id,
      messages,
      tokenCount,
      compactionCount: session.compactionCount,
    };
  }

  /**
   * Convert internal messages to API format
   */
  toAPIMessages(messages: Message[]): APIMessage[] {
    return messages
      .filter(msg => msg.role !== 'system')
      .map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: typeof msg.content === 'string' ? msg.content : msg.content as ContentBlock[],
      }));
  }

  /**
   * Add a message to the session
   */
  addMessage(
    sessionId: string,
    role: Message['role'],
    content: Message['content'],
    parentUuid: string | null = null,
    tokenCount?: number
  ): Message {
    return this.db.messages.create(sessionId, {
      parentUuid,
      role,
      content,
      createdAt: Date.now(),
      tokenCount,
    });
  }

  /**
   * Check if compaction is needed
   */
  needsCompaction(tokenCount: number): boolean {
    const threshold = this.config.effectiveContextWindow * this.config.compactionThreshold;
    return tokenCount > threshold;
  }

  /**
   * Check if at token limit
   */
  atLimit(tokenCount: number): boolean {
    const limit = this.config.effectiveContextWindow * 0.98;
    return tokenCount > limit;
  }

  /**
   * Compact the conversation history
   */
  async compact(
    sessionId: string,
    systemPrompt: string
  ): Promise<{ summary: string; beforeTokens: number; afterTokens: number }> {
    const beforeTokens = this.db.messages.getTokenCount(sessionId);
    const messages = this.db.messages.list(sessionId);

    if (messages.length < 4) {
      return { summary: '', beforeTokens, afterTokens: beforeTokens };
    }

    // Build conversation text for summarization
    const conversationText = messages
      .map((m) => {
        const content = typeof m.content === 'string'
          ? m.content
          : JSON.stringify(m.content);
        return `${m.role.toUpperCase()}: ${content}`;
      })
      .join('\n\n');

    // Call provider for summarization using compactionChat
    const response = await this.provider.compactionChat({
      model: COMPACTION_MODEL,
      messages: [{ role: 'user', content: conversationText }],
      maxTokens: 2000,
      systemPrompt: COMPACTION_PROMPT,
    });

    // Extract text from response
    const summaryBlock = response.content.find((b) => b.type === 'text');
    const summary = summaryBlock?.text ?? '';

    // Delete old messages
    this.db.messages.deleteSession(sessionId);

    // Add summary as first message
    this.addMessage(sessionId, 'system', `[Previous conversation summary]\n\n${summary}`);

    const afterTokens = this.db.messages.getTokenCount(sessionId);

    // Update session compaction count
    const session = await this.db.sessions.get(sessionId);
    if (session) {
      await this.db.sessions.update(sessionId, {
        compactionCount: session.compactionCount + 1,
        lastActivity: Date.now(),
      });
    }

    await this.eventBus.emit('session:compact', {
      sessionId,
      beforeTokens,
      afterTokens,
    });

    getLogger().info('Session compacted', {
      sessionId,
      beforeTokens,
      afterTokens,
      reduction: `${Math.round((1 - afterTokens / beforeTokens) * 100)}%`,
    });

    return { summary, beforeTokens, afterTokens };
  }

  /**
   * Validate message chain integrity
   */
  validateChain(sessionId: string): { valid: boolean; brokenAt?: string } {
    return this.db.messages.validateChain(sessionId);
  }

  /**
   * Update session activity
   */
  async updateActivity(sessionId: string, tokensUsed: number): Promise<void> {
    const session = await this.db.sessions.get(sessionId);
    if (session) {
      await this.db.sessions.update(sessionId, {
        lastActivity: Date.now(),
        totalTokensUsed: session.totalTokensUsed + tokensUsed,
      });
    }
  }
}
