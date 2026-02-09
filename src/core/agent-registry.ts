/**
 * Agent Registry - Loading and Spawning Agents
 * Manages agent definitions and subagent lifecycle.
 * Wires spawnSubagent() to AgenticLoop for actual execution.
 */

import type { AgentDefinition, AgentResult, SubagentRecord, Config, ToolDefinition } from './types';
import type { Database } from '../infra/database';
import { EventBus } from './event-bus';
import type { LLMProvider } from './plugin-api-types';
import type { SessionPersistence } from './session-persistence';
import { getLogger } from '../infra/logger';
import { BUILTIN_TOOLS } from './loop/tools';

export const MAX_SUBAGENT_DEPTH = 3;
export const DEFAULT_SUBAGENT_TIMEOUT_MS = 5 * 60 * 1000;

export interface SpawnSubagentOptions {
  timeout?: number;
  tools?: string[];
  parentId?: string;
  depth?: number;
  /** Resume a previous subagent session by ID */
  resumeSessionId?: string;
}

/** Factory for creating AgenticLoop instances. Injected at runtime to avoid circular imports. */
export type LoopFactory = (options: {
  db: Database; eventBus: EventBus; config: Config; provider: LLMProvider;
}) => {
  run(message: string, config: LoopRunConfig): Promise<LoopRunResult>;
  resume?(sessionId: string, message: string, config: LoopRunConfig): Promise<LoopRunResult>;
};

export type StreamChunkType = 'text_delta' | 'tool_use' | 'tool_result';

export interface LoopRunConfig {
  sessionId?: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  toolExecutors?: Map<string, (id: string, input: Record<string, unknown>) => Promise<{ toolUseId: string; content: string; isError?: boolean }>>;
  timeoutMs?: number;
  maxIterations?: number;
  onStream?: (chunk: { type: string; [key: string]: unknown }) => void;
}

export interface LoopRunResult {
  response: string;
  sessionId: string;
  tokensUsed: { input: number; output: number };
  toolCalls: Array<{ name: string; durationMs: number }>;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Agent Registry Class
// ---------------------------------------------------------------------------

export class AgentRegistry {
  private agents: Map<string, AgentDefinition> = new Map();
  private db: Database;
  private eventBus: EventBus;
  private config: Config;
  private activeSubagents: Map<string, SubagentRecord> = new Map();
  private provider: LLMProvider | null = null;
  private loopFactory: LoopFactory | null = null;

  constructor(options: { db: Database; eventBus: EventBus; config: Config }) {
    this.db = options.db;
    this.eventBus = options.eventBus;
    this.config = options.config;
  }

  /** Set the LLM provider for subagent execution. Call before spawnSubagent(). */
  setProvider(provider: LLMProvider): void { this.provider = provider; }

  /** Set the loop factory for subagent execution. Call before spawnSubagent(). */
  setLoopFactory(factory: LoopFactory): void { this.loopFactory = factory; }

  registerAgent(agent: AgentDefinition): void {
    this.agents.set(agent.name, agent);
    getLogger().debug(`Registered agent: ${agent.name}`, {
      plugin: agent.pluginId,
      color: agent.color,
    });
  }

  loadAgents(agents: AgentDefinition[]): void {
    for (const agent of agents) {
      this.registerAgent(agent);
    }
  }

  getAgent(name: string): AgentDefinition | undefined { return this.agents.get(name); }
  listAgents(): AgentDefinition[] { return Array.from(this.agents.values()); }
  hasAgent(name: string): boolean { return this.agents.has(name); }

  /**
   * Spawn a subagent with a task and run it via AgenticLoop.
   * Blocks until the subagent completes, fails, or times out.
   * Returns the updated SubagentRecord with result.
   */
  async spawnSubagent(
    agentName: string,
    task: string,
    options?: SpawnSubagentOptions,
  ): Promise<SubagentRecord> {
    const currentDepth = options?.depth ?? 0;
    if (currentDepth >= MAX_SUBAGENT_DEPTH) {
      throw new Error(
        `Maximum subagent nesting depth (${MAX_SUBAGENT_DEPTH}) exceeded. ` +
        `Cannot spawn '${agentName}' at depth ${currentDepth}.`
      );
    }

    const agent = this.getAgent(agentName);
    if (!agent) {
      throw new Error(`Agent '${agentName}' not found`);
    }

    const timeoutMs = options?.timeout ?? DEFAULT_SUBAGENT_TIMEOUT_MS;
    const now = Date.now();

    const record = this.db.subagents.create({
      agentName,
      parentId: options?.parentId ?? null,
      taskDescription: task,
      status: 'running',
      spawnedAt: now,
      timeoutMs,
    });

    this.activeSubagents.set(record.id, record);
    await this.eventBus.emit('subagent:spawn', { record });

    getLogger().info(`Spawned subagent: ${agentName}`, {
      id: record.id,
      task: task.slice(0, 100),
      timeout: timeoutMs,
      depth: currentDepth,
    });

    return this.runSubagentLoop(record, agent, task, timeoutMs, options?.tools);
  }

  /** Run the AgenticLoop for a subagent and update the record on completion. */
  private async runSubagentLoop(
    record: SubagentRecord,
    agent: AgentDefinition,
    task: string,
    timeoutMs: number,
    toolOverrides?: string[],
  ): Promise<SubagentRecord> {
    if (!this.provider || !this.loopFactory) {
      getLogger().warn('No provider/loopFactory set; finalizing subagent as failed', { id: record.id });
      return this.finalizeSubagent(record.id, 'failed', undefined, 'No provider or loopFactory configured');
    }

    const startTime = Date.now();
    const resolvedModel = this.resolveModel(agent);
    const loopConfig = this.buildLoopConfig(agent, timeoutMs, toolOverrides);

    try {
      const loop = this.loopFactory({
        db: this.db,
        eventBus: this.eventBus,
        config: { ...this.config, model: resolvedModel },
        provider: this.provider,
      });

      let timer: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      });

      try {
        const result = await Promise.race([loop.run(task, loopConfig), timeoutPromise]);

        if (result === null) {
          // Timeout fired before loop completed. The loop continues running in the background.
          // AgenticLoop has an interrupt() method but no hard-cancel; call it to stop iteration.
          if ('interrupt' in loop && typeof (loop as { interrupt: () => void }).interrupt === 'function') {
            (loop as { interrupt: () => void }).interrupt();
          }
          return this.finalizeSubagent(record.id, 'timeout');
        }

        return this.finalizeSubagent(record.id, 'completed', {
          agentId: record.id,
          output: result.response || 'Subagent completed with no output',
          tokensUsed: result.tokensUsed.input + result.tokensUsed.output,
          toolUses: result.toolCalls.length,
          durationMs: Date.now() - startTime,
        });
      } finally {
        clearTimeout(timer!);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      getLogger().error(`Subagent loop failed: ${agent.name}`, { id: record.id, error: errorMsg });
      return this.finalizeSubagent(record.id, 'failed', undefined, errorMsg);
    }
  }

  private buildLoopConfig(
    agent: AgentDefinition,
    timeoutMs: number,
    toolOverrides?: string[],
  ): LoopRunConfig {
    const agentTools = toolOverrides ?? agent.tools;
    const filteredTools: ToolDefinition[] = agentTools?.length
      ? BUILTIN_TOOLS.filter(t => agentTools.includes(t.name))
      : BUILTIN_TOOLS;

    return {
      systemPrompt: agent.systemPrompt,
      tools: filteredTools,
      timeoutMs,
      maxIterations: 50,
    };
  }

  /**
   * Finalize a subagent by updating the DB, cleaning up tracking, emitting events, and logging.
   * Consolidates the shared logic of completeSubagent, failSubagent, and timeoutSubagent.
   */
  private async finalizeSubagent(
    id: string,
    status: 'completed' | 'failed' | 'timeout',
    agentResult?: AgentResult,
    error?: string,
  ): Promise<SubagentRecord> {
    const updateData: Record<string, unknown> = {
      status,
      completedAt: Date.now(),
    };

    if (status === 'completed' && agentResult) {
      updateData.result = agentResult.output;
      updateData.tokensUsed = agentResult.tokensUsed;
      updateData.toolUses = agentResult.toolUses;
    } else if (status === 'failed' && error) {
      updateData.result = `Error: ${error}`;
    }

    const record = this.db.subagents.update(id, updateData);
    this.activeSubagents.delete(id);

    if (status === 'completed') {
      await this.eventBus.emit('subagent:complete', { record });
      getLogger().info(`Subagent completed: ${record.agentName}`, {
        id,
        tokensUsed: agentResult?.tokensUsed,
        toolUses: agentResult?.toolUses,
        durationMs: agentResult?.durationMs,
      });
    } else if (status === 'failed') {
      getLogger().error(`Subagent failed: ${record.agentName}`, { id, error });
    } else {
      await this.eventBus.emit('subagent:timeout', { record });
      getLogger().warn(`Subagent timed out: ${record.agentName}`, { id });
    }

    return record;
  }

  async completeSubagent(id: string, agentResult: AgentResult): Promise<SubagentRecord> {
    return this.finalizeSubagent(id, 'completed', agentResult);
  }

  async failSubagent(id: string, error: string): Promise<SubagentRecord> {
    return this.finalizeSubagent(id, 'failed', undefined, error);
  }

  async timeoutSubagent(id: string): Promise<SubagentRecord> {
    return this.finalizeSubagent(id, 'timeout');
  }

  getRunningSubagents(): SubagentRecord[] { return this.db.subagents.getRunning(); }

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

  async markOrphaned(olderThanMs: number): Promise<number> {
    return this.db.subagents.markOrphaned(olderThanMs);
  }

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
