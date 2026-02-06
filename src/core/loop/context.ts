/**
 * Context Builder and Compaction
 * Manages conversation context and token-aware summarization
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Message, Config } from '../types';
import type { Database } from '../../infra/database';
import type { EventBus } from '../event-bus';
import type { LLMProvider } from '../plugin-api-types';
import type { SessionContext, APIMessage, ContentBlock } from './types';
import { summarizeAndReplace, updateCompactionStats, validateChain, updateActivity } from './compaction';
import { getLogger } from '../../infra/logger';

// ---------------------------------------------------------------------------
// Context Builder Class
// ---------------------------------------------------------------------------

export class ContextBuilder {
  private db: Database;
  private eventBus: EventBus;
  private config: Config;
  private provider: LLMProvider;
  private agentContextCache: string | null | undefined = undefined;

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
   * Load AGENT.md project context from .daemux/AGENT.md.
   * Caches the result so the file is only read once per ContextBuilder instance.
   */
  async loadAgentContext(): Promise<string | null> {
    if (this.agentContextCache !== undefined) {
      return this.agentContextCache;
    }

    const agentMdPath = join(process.cwd(), '.daemux', 'AGENT.md');

    try {
      if (!existsSync(agentMdPath)) {
        this.agentContextCache = null;
        return null;
      }

      const content = readFileSync(agentMdPath, 'utf-8').trim();
      if (content.length === 0) {
        this.agentContextCache = null;
        return null;
      }

      this.agentContextCache = content;
      getLogger().debug('Loaded AGENT.md project context', {
        path: agentMdPath,
        length: content.length,
      });
      return content;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      getLogger().warn('Failed to load AGENT.md', { path: agentMdPath, error: msg });
      this.agentContextCache = null;
      return null;
    }
  }

  /**
   * Build a system prompt with optional AGENT.md context appended.
   */
  async buildSystemPrompt(basePrompt: string): Promise<string> {
    const agentContext = await this.loadAgentContext();
    if (!agentContext) {
      return basePrompt;
    }

    return `${basePrompt}\n\n--- Project Context (AGENT.md) ---\n${agentContext}\n---`;
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

    const summary = await summarizeAndReplace(
      this.provider, this.db, sessionId, messages, this.addMessage.bind(this),
    );
    const afterTokens = this.db.messages.getTokenCount(sessionId);

    await updateCompactionStats(this.db, this.eventBus, sessionId, beforeTokens, afterTokens);

    return { summary, beforeTokens, afterTokens };
  }

}
