/**
 * Agent Factory
 * Dynamically creates agent definitions using a fast LLM call.
 * Generated agents are ephemeral (in-memory only, pluginId: 'dynamic').
 */

import type { AgentDefinition } from './types';
import type { LLMProvider } from './plugin-api-types';
import type { AgentRegistry } from './agent-registry';
import { getLogger } from '../infra/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentFactoryDeps {
  provider: LLMProvider;
  registry: AgentRegistry;
}

export interface CreateAgentOptions {
  tools?: string[];
  model?: string;
}

interface ParsedAgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  model: ValidModel;
  color: ValidColor;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_MODELS = ['inherit', 'sonnet', 'opus', 'haiku'] as const;
type ValidModel = typeof VALID_MODELS[number];

const VALID_COLORS = ['blue', 'cyan', 'green', 'yellow', 'red'] as const;
type ValidColor = typeof VALID_COLORS[number];

const HAIKU_MODEL = 'claude-haiku-3-5-20250514';

const GENERATION_PROMPT = `You are an agent configuration generator. Given a task description, generate a JSON object defining an AI agent optimized for that task.

The JSON must have these exact fields:
- "name": lowercase alphanumeric with hyphens, 3-50 chars, starting with a letter (e.g. "code-reviewer")
- "description": one-line description of what the agent does (max 100 chars)
- "systemPrompt": detailed instructions for the agent (2-5 sentences)
- "tools": array of tool names the agent needs. Available tools: Read, Write, Edit, Bash, Glob, Grep, SpawnAgent
- "model": one of "inherit", "haiku", "sonnet", "opus". Use "haiku" for simple/fast tasks, "inherit" for general, "sonnet"/"opus" for complex reasoning
- "color": one of "blue", "cyan", "green", "yellow", "red"

Respond with ONLY the JSON object, no markdown fencing, no explanation.`;

// ---------------------------------------------------------------------------
// AgentFactory
// ---------------------------------------------------------------------------

export class AgentFactory {
  private deps: AgentFactoryDeps;

  constructor(deps: AgentFactoryDeps) {
    this.deps = deps;
  }

  async createAgent(
    taskDescription: string,
    options?: CreateAgentOptions,
  ): Promise<AgentDefinition> {
    if (!taskDescription?.trim()) {
      throw new Error('Task description is required');
    }

    const config = await this.generateConfig(taskDescription.trim());
    const agent = this.buildDefinition(config, options);

    this.deps.registry.registerAgent(agent);
    getLogger().info('Dynamic agent created', { name: agent.name, tools: agent.tools });

    return agent;
  }

  private async generateConfig(taskDescription: string): Promise<ParsedAgentConfig> {
    const userPrompt = `Generate an agent configuration for this task:\n\n${taskDescription}`;

    try {
      const response = await this.deps.provider.compactionChat({
        model: HAIKU_MODEL,
        messages: [{ role: 'user', content: userPrompt }],
        systemPrompt: GENERATION_PROMPT,
        maxTokens: 500,
      });

      const text = this.extractText(response);
      return this.parseResponse(text);
    } catch (err) {
      getLogger().error('AgentFactory LLM call failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw new Error(
        `Failed to generate agent config: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private extractText(response: { content: Array<{ type: string; text?: string }> }): string {
    for (const block of response.content) {
      if (block.type === 'text' && block.text) {
        return block.text.trim();
      }
    }
    throw new Error('LLM response contained no text content');
  }

  private parseResponse(text: string): ParsedAgentConfig {
    // Strip markdown code fences if present
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(`Failed to parse agent config JSON: ${cleaned.slice(0, 200)}`);
    }

    return this.validateConfig(parsed);
  }

  private validateConfig(raw: Record<string, unknown>): ParsedAgentConfig {
    const name = String(raw.name ?? '').trim();
    if (!name || !/^[a-z][a-z0-9-]{2,49}$/.test(name)) {
      throw new Error(`Invalid agent name: "${name}". Must match /^[a-z][a-z0-9-]{2,49}$/`);
    }

    const description = String(raw.description ?? 'Dynamic agent').trim();
    const systemPrompt = String(raw.systemPrompt ?? 'You are a helpful assistant.').trim();

    const tools = Array.isArray(raw.tools)
      ? raw.tools.filter((t): t is string => typeof t === 'string')
      : [];

    const model = VALID_MODELS.includes(raw.model as ValidModel)
      ? (raw.model as ValidModel)
      : 'inherit';

    const color = VALID_COLORS.includes(raw.color as ValidColor)
      ? (raw.color as ValidColor)
      : 'blue';

    return { name, description, systemPrompt, tools, model, color };
  }

  private buildDefinition(
    config: ParsedAgentConfig,
    options?: CreateAgentOptions,
  ): AgentDefinition {
    return {
      name: this.ensureUniqueName(config.name),
      description: config.description,
      model: this.resolveModel(config.model, options?.model),
      tools: options?.tools ?? config.tools,
      color: config.color,
      systemPrompt: config.systemPrompt,
      pluginId: 'dynamic',
    };
  }

  private ensureUniqueName(baseName: string): string {
    if (!this.deps.registry.hasAgent(baseName)) {
      return baseName;
    }
    // Append a short suffix to avoid collision
    const suffix = Date.now().toString(36).slice(-4);
    return `${baseName}-${suffix}`;
  }

  private resolveModel(generated: ValidModel, override?: string): ValidModel {
    if (override && VALID_MODELS.includes(override as ValidModel)) {
      return override as ValidModel;
    }
    return generated;
  }
}
