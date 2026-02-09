/**
 * Agent Persistence
 * Tracks success count for dynamically created agents.
 * When an agent succeeds 3+ times, persists it to ~/.daemux/agents/{name}.md
 * so it loads on subsequent startups alongside built-in agents.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { AgentDefinition } from './types';
import { parseFrontmatter } from './agent-loader';
import { getLogger } from '../infra/logger';

const DEFAULT_THRESHOLD = 3;
const VALID_AGENT_NAME = /^[a-z][a-z0-9-]{2,49}$/;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class AgentPersistence {
  private successCounts: Map<string, number> = new Map();
  private threshold: number;
  private agentsDir: string;

  constructor(options?: { threshold?: number; agentsDir?: string }) {
    this.threshold = options?.threshold ?? DEFAULT_THRESHOLD;
    this.agentsDir = options?.agentsDir ?? join(homedir(), '.daemux', 'agents');
  }

  /** Record a successful execution for a dynamic agent. */
  recordSuccess(agent: AgentDefinition): void {
    if (agent.pluginId !== 'dynamic') return;

    const count = (this.successCounts.get(agent.name) ?? 0) + 1;
    this.successCounts.set(agent.name, count);

    getLogger().debug('Agent success recorded', {
      name: agent.name,
      count,
      threshold: this.threshold,
    });

    if (count === this.threshold) {
      this.persist(agent).catch((err) => {
        getLogger().error('Failed to persist agent', {
          name: agent.name,
          error: errorMessage(err),
        });
      });
    }
  }

  /** Check whether an agent has reached the persistence threshold. */
  shouldPersist(agentName: string): boolean {
    return (this.successCounts.get(agentName) ?? 0) >= this.threshold;
  }

  /** Get the current success count for an agent. */
  getSuccessCount(agentName: string): number {
    return this.successCounts.get(agentName) ?? 0;
  }

  /** Persist an AgentDefinition to disk as a markdown file. */
  async persist(agent: AgentDefinition): Promise<void> {
    if (!VALID_AGENT_NAME.test(agent.name)) {
      throw new Error(`Invalid agent name for persistence: "${agent.name}"`);
    }

    mkdirSync(this.agentsDir, { recursive: true });

    const filePath = join(this.agentsDir, `${agent.name}.md`);
    writeFileSync(filePath, this.toMarkdown(agent), { encoding: 'utf-8', mode: 0o600 });
    try {
      chmodSync(filePath, 0o600);
    } catch {
      // Ignore chmod errors on Windows
    }
    getLogger().info('Agent persisted to disk', { name: agent.name, path: filePath });
  }

  /** Load all persisted agents from ~/.daemux/agents/. */
  async loadPersistedAgents(): Promise<AgentDefinition[]> {
    if (!existsSync(this.agentsDir)) return [];

    let files: string[];
    try {
      files = readdirSync(this.agentsDir).filter(f => f.endsWith('.md'));
    } catch {
      return [];
    }

    const agents: AgentDefinition[] = [];
    for (const file of files) {
      try {
        const content = readFileSync(join(this.agentsDir, file), 'utf-8');
        const agent = this.fromMarkdown(content);
        if (agent) agents.push(agent);
      } catch (err) {
        getLogger().warn('Failed to load persisted agent', {
          file,
          error: errorMessage(err),
        });
      }
    }
    return agents;
  }

  /** Convert an AgentDefinition to frontmatter + system prompt. */
  private toMarkdown(agent: AgentDefinition): string {
    const tools = agent.tools?.length
      ? `tools:\n${agent.tools.map(t => `  - ${t}`).join('\n')}`
      : 'tools: []';

    return [
      '---',
      `name: ${agent.name}`,
      `description: ${agent.description}`,
      `model: ${agent.model}`,
      tools,
      `color: ${agent.color}`,
      '---',
      '',
      agent.systemPrompt,
      '',
    ].join('\n');
  }

  /** Parse a markdown file into an AgentDefinition, returning null on invalid data. */
  private fromMarkdown(content: string): AgentDefinition | null {
    const { data, body } = parseFrontmatter(content);
    if (!data.name || !data.description) return null;

    return {
      name: data.name as string,
      description: data.description as string,
      model: (data.model as AgentDefinition['model']) || 'inherit',
      tools: Array.isArray(data.tools) ? (data.tools as string[]) : [],
      color: (data.color as AgentDefinition['color']) || 'blue',
      systemPrompt: body.trim(),
      pluginId: 'persisted',
    };
  }
}
