/**
 * Agent Registry - Loading and Spawning Agents
 * Manages agent definitions and subagent lifecycle
 */

import { randomUUID } from 'crypto';
import type { AgentDefinition, AgentResult, SubagentRecord, Config } from './types';
import type { Database } from '../infra/database';
import { EventBus } from './event-bus';
import { getLogger } from '../infra/logger';

// ---------------------------------------------------------------------------
// Agent Registry Class
// ---------------------------------------------------------------------------

export class AgentRegistry {
  private agents: Map<string, AgentDefinition> = new Map();
  private db: Database;
  private eventBus: EventBus;
  private config: Config;
  private activeSubagents: Map<string, SubagentRecord> = new Map();

  constructor(options: { db: Database; eventBus: EventBus; config: Config }) {
    this.db = options.db;
    this.eventBus = options.eventBus;
    this.config = options.config;
  }

  /**
   * Register an agent definition
   */
  registerAgent(agent: AgentDefinition): void {
    this.agents.set(agent.name, agent);
    getLogger().debug(`Registered agent: ${agent.name}`, {
      plugin: agent.pluginId,
      color: agent.color,
    });
  }

  /**
   * Load multiple agent definitions
   */
  loadAgents(agents: AgentDefinition[]): void {
    for (const agent of agents) {
      this.registerAgent(agent);
    }
  }

  /**
   * Get an agent by name
   */
  getAgent(name: string): AgentDefinition | undefined {
    return this.agents.get(name);
  }

  /**
   * List all registered agents
   */
  listAgents(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  /**
   * Check if an agent exists
   */
  hasAgent(name: string): boolean {
    return this.agents.has(name);
  }

  /**
   * Spawn a subagent with a task
   * This creates a record and delegates to the loop for execution
   */
  async spawnSubagent(
    agentName: string,
    task: string,
    options?: {
      timeout?: number;
      tools?: string[];
      parentId?: string;
    }
  ): Promise<SubagentRecord> {
    const agent = this.getAgent(agentName);
    if (!agent) {
      throw new Error(`Agent '${agentName}' not found`);
    }

    const timeoutMs = options?.timeout ?? this.config.turnTimeoutMs;
    const now = Date.now();

    // Create subagent record in database
    const record = this.db.subagents.create({
      agentName,
      parentId: options?.parentId ?? null,
      taskDescription: task,
      status: 'running',
      spawnedAt: now,
      timeoutMs,
    });

    this.activeSubagents.set(record.id, record);

    // Emit spawn event
    await this.eventBus.emit('subagent:spawn', { record });

    getLogger().info(`Spawned subagent: ${agentName}`, {
      id: record.id,
      task: task.slice(0, 100),
      timeout: timeoutMs,
    });

    return record;
  }

  /**
   * Mark a subagent as completed
   */
  async completeSubagent(
    id: string,
    result: AgentResult
  ): Promise<SubagentRecord> {
    const record = this.db.subagents.update(id, {
      status: 'completed',
      completedAt: Date.now(),
      result: result.output,
      tokensUsed: result.tokensUsed,
      toolUses: result.toolUses,
    });

    this.activeSubagents.delete(id);

    await this.eventBus.emit('subagent:complete', { record });

    getLogger().info(`Subagent completed: ${record.agentName}`, {
      id,
      tokensUsed: result.tokensUsed,
      toolUses: result.toolUses,
      durationMs: result.durationMs,
    });

    return record;
  }

  /**
   * Mark a subagent as failed
   */
  async failSubagent(id: string, error: string): Promise<SubagentRecord> {
    const record = this.db.subagents.update(id, {
      status: 'failed',
      completedAt: Date.now(),
      result: `Error: ${error}`,
    });

    this.activeSubagents.delete(id);

    getLogger().error(`Subagent failed: ${record.agentName}`, {
      id,
      error,
    });

    return record;
  }

  /**
   * Mark a subagent as timed out
   */
  async timeoutSubagent(id: string): Promise<SubagentRecord> {
    const record = this.db.subagents.update(id, {
      status: 'timeout',
      completedAt: Date.now(),
    });

    this.activeSubagents.delete(id);

    await this.eventBus.emit('subagent:timeout', { record });

    getLogger().warn(`Subagent timed out: ${record.agentName}`, { id });

    return record;
  }

  /**
   * Get all running subagents
   */
  getRunningSubagents(): SubagentRecord[] {
    return this.db.subagents.getRunning();
  }

  /**
   * Check for timed out subagents and mark them
   */
  async checkTimeouts(): Promise<number> {
    const running = this.getRunningSubagents();
    const now = Date.now();
    let timedOut = 0;

    for (const record of running) {
      if (now > record.spawnedAt + record.timeoutMs) {
        await this.timeoutSubagent(record.id);
        timedOut++;
      }
    }

    return timedOut;
  }

  /**
   * Mark orphaned subagents (running but process is gone)
   */
  async markOrphaned(olderThanMs: number): Promise<number> {
    return this.db.subagents.markOrphaned(olderThanMs);
  }

  /**
   * Resolve model name from agent definition
   */
  resolveModel(agent: AgentDefinition): Config['model'] {
    if (agent.model === 'inherit') {
      return this.config.model;
    }

    const modelMap: Record<string, Config['model']> = {
      sonnet: 'claude-sonnet-4-20250514',
      opus: 'claude-opus-4-20250514',
      haiku: 'claude-haiku-3-5-20250514',
    };

    return modelMap[agent.model] ?? this.config.model;
  }

  /**
   * Get tools for an agent (filtered or all)
   */
  getAgentTools(agent: AgentDefinition, availableTools: string[]): string[] {
    if (!agent.tools || agent.tools.length === 0) {
      return availableTools;
    }
    return agent.tools.filter(t => availableTools.includes(t));
  }
}

// ---------------------------------------------------------------------------
// Global Agent Registry Instance
// ---------------------------------------------------------------------------

let globalRegistry: AgentRegistry | null = null;

export function createAgentRegistry(options: {
  db: Database;
  eventBus: EventBus;
  config: Config;
}): AgentRegistry {
  globalRegistry = new AgentRegistry(options);
  return globalRegistry;
}

export function getAgentRegistry(): AgentRegistry {
  if (!globalRegistry) {
    throw new Error('Agent registry not initialized. Call createAgentRegistry first.');
  }
  return globalRegistry;
}
