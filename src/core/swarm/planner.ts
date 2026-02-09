/** Swarm planning - LLM-based task decomposition into agent subtasks. */

import type { LLMProvider } from '../plugin-api-types';
import { getLogger } from '../../infra/logger';

const HAIKU_MODEL = 'claude-haiku-3-5-20250514';
const MAX_PLAN_TOKENS = 1000;

const PLANNING_PROMPT = `You are a task planner for a multi-agent system.
Given a complex task, break it into subtasks and assign agent roles.

Available agent types:
- explore: Read-only code exploration (tools: Read, Glob, Grep, Bash)
- plan: Architecture design, read-only (tools: Read, Glob, Grep)
- general: Full capability agent (tools: all)

Respond with ONLY a JSON array of objects, each with:
- "name": agent name (lowercase with hyphens, e.g. "backend-dev")
- "role": brief role description
- "task": the specific subtask to execute

Example:
[{"name":"api-builder","role":"Backend developer","task":"Create the REST API endpoints"}]

Keep the number of agents between 2 and the specified maximum.
No markdown fencing, no explanation.`;

export interface PlannedAgent {
  name: string;
  role: string;
  task: string;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Plan agents by calling the LLM to decompose a task into subtasks. */
export async function planAgents(
  provider: LLMProvider,
  task: string,
  maxAgents: number,
): Promise<PlannedAgent[]> {
  try {
    const response = await provider.compactionChat({
      model: HAIKU_MODEL,
      messages: [{
        role: 'user',
        content: `Maximum agents: ${maxAgents}\n\nTask: ${task}`,
      }],
      systemPrompt: PLANNING_PROMPT,
      maxTokens: MAX_PLAN_TOKENS,
    });

    const text = extractText(response);
    return parsePlan(text, maxAgents);
  } catch (err) {
    getLogger().warn('Swarm planning failed, using single general agent', {
      error: errMsg(err),
    });
    return [{ name: 'general-worker', role: 'General agent', task }];
  }
}

function parsePlan(text: string, maxAgents: number): PlannedAgent[] {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  let parsed: unknown[];
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    getLogger().warn('Failed to parse swarm plan JSON, using single agent');
    return [{ name: 'general-worker', role: 'General agent', task: cleaned }];
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return [{ name: 'general-worker', role: 'General agent', task: 'Execute the task' }];
  }

  return parsed
    .slice(0, maxAgents)
    .map((entry, index) => {
      const raw = entry as Record<string, unknown>;
      return {
        name: String(raw.name ?? `agent-${index}`).toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        role: String(raw.role ?? 'Worker'),
        task: String(raw.task ?? 'Execute assigned subtask'),
      };
    });
}

function extractText(
  response: { content: Array<{ type: string; text?: string }> },
): string {
  for (const block of response.content) {
    if (block.type === 'text' && block.text) {
      return block.text.trim();
    }
  }
  throw new Error('LLM response contained no text content');
}
