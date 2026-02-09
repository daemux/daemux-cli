/**
 * Complexity Classifier
 * Classifies tasks as simple, medium, or complex using a fast LLM call.
 * Used to decide routing: direct answer, single agent, or swarm.
 */

import type { LLMProvider } from './plugin-api-types';
import { getLogger } from '../infra/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskComplexity = 'simple' | 'medium' | 'complex';

export interface ClassifierDeps {
  provider: LLMProvider;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_COMPLEXITIES = ['simple', 'medium', 'complex'] as const;
const HAIKU_MODEL = 'claude-haiku-3-5-20250514';

const CLASSIFICATION_PROMPT = `You are a task complexity classifier. Classify the given task into exactly one category.

Classification criteria:
- "simple": Single-step tasks, factual questions, quick lookups, greetings, math, definitions
- "medium": Multi-step but focused tasks, single-file changes, debugging, code review, research
- "complex": Multi-file changes, architectural decisions, multi-concern tasks needing planning and execution, refactoring across modules

Respond with ONLY one word: simple, medium, or complex`;

// ---------------------------------------------------------------------------
// ComplexityClassifier
// ---------------------------------------------------------------------------

export class ComplexityClassifier {
  private deps: ClassifierDeps;

  constructor(deps: ClassifierDeps) {
    this.deps = deps;
  }

  async classify(task: string, context?: string): Promise<TaskComplexity> {
    if (!task?.trim()) {
      return 'simple';
    }

    try {
      const userMessage = context
        ? `Task: ${task.trim()}\n\nContext: ${context.trim()}`
        : `Task: ${task.trim()}`;

      const response = await this.deps.provider.compactionChat({
        model: HAIKU_MODEL,
        messages: [{ role: 'user', content: userMessage }],
        systemPrompt: CLASSIFICATION_PROMPT,
        maxTokens: 10,
      });

      return this.parseClassification(response);
    } catch (err) {
      getLogger().error('Complexity classification failed, defaulting to medium', {
        error: err instanceof Error ? err.message : String(err),
      });
      return 'medium';
    }
  }

  private parseClassification(
    response: { content: Array<{ type: string; text?: string }> },
  ): TaskComplexity {
    for (const block of response.content) {
      if (block.type === 'text' && block.text) {
        const normalized = block.text.trim().toLowerCase();
        if (VALID_COMPLEXITIES.includes(normalized as TaskComplexity)) {
          return normalized as TaskComplexity;
        }
        // Try to find a valid complexity anywhere in the response
        for (const complexity of VALID_COMPLEXITIES) {
          if (normalized.includes(complexity)) {
            return complexity;
          }
        }
      }
    }

    getLogger().warn('Could not parse complexity from LLM response, defaulting to medium');
    return 'medium';
  }
}
