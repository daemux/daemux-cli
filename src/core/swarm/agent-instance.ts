/** Wraps an individual agent within a swarm, managing its execution lifecycle. */

import type { AgentRegistry } from '../agent-registry';
import type { SwarmMessageBus } from './message-bus';
import type { SwarmAgent } from './types';
import { getLogger } from '../../infra/logger';

export interface SwarmAgentInstanceConfig {
  agent: SwarmAgent;
  registry: AgentRegistry;
  messageBus: SwarmMessageBus;
  onComplete: (agentId: string, result: string, tokensUsed?: number, toolUses?: number) => void;
  onFail: (agentId: string, error: string) => void;
}

export class SwarmAgentInstance {
  private config: SwarmAgentInstanceConfig;
  private stopped = false;
  private abortController: AbortController;

  constructor(config: SwarmAgentInstanceConfig) {
    this.config = config;
    this.abortController = new AbortController();
  }

  get agentId(): string {
    return this.config.agent.id;
  }

  get agentName(): string {
    return this.config.agent.name;
  }

  get status(): SwarmAgent['status'] {
    return this.config.agent.status;
  }

  /** Execute a task. Blocks until completion, failure, or stop(). */
  async execute(task: string): Promise<string> {
    if (this.stopped) {
      throw new Error(`Agent '${this.agentName}' has been stopped`);
    }

    this.config.agent.status = 'working';
    const logger = getLogger();
    logger.debug(`SwarmAgentInstance executing: ${this.agentName}`, {
      agentId: this.agentId,
      task: task.slice(0, 100),
    });

    try {
      const record = await this.runWithAbort(task);

      if (this.stopped || this.abortController.signal.aborted) {
        throw new Error('Agent stopped during execution');
      }

      if (record.status === 'completed') {
        const output = record.result || 'Completed with no output';
        this.config.agent.status = 'done';
        this.config.onComplete(this.agentId, output, record.tokensUsed, record.toolUses);
        return output;
      }

      const errorMsg = record.status === 'timeout'
        ? `Agent '${this.agentName}' timed out after ${record.timeoutMs}ms`
        : record.result || 'Unknown agent failure';
      throw new Error(errorMsg);
    } catch (err) {
      const errorMsg = this.stopped
        ? 'Agent stopped'
        : (err instanceof Error ? err.message : String(err));

      this.config.agent.status = 'failed';
      this.config.onFail(this.agentId, errorMsg);

      throw this.stopped ? new Error(errorMsg) : err;
    }
  }

  /** Stop the agent. Aborts any running execution. */
  stop(): void {
    this.stopped = true;
    this.abortController.abort();
    getLogger().debug(`SwarmAgentInstance stopped: ${this.agentName}`, {
      agentId: this.agentId,
    });
  }

  /** Check if this instance has been stopped. */
  isStopped(): boolean {
    return this.stopped;
  }

  private async runWithAbort(
    task: string,
  ): Promise<{ status: string; result?: string; timeoutMs: number; tokensUsed?: number; toolUses?: number }> {
    if (this.abortController.signal.aborted) {
      throw new Error(`Agent '${this.agentName}' was aborted before execution`);
    }

    const agentDef = this.config.registry.getAgent(this.agentName);
    if (!agentDef) {
      throw new Error(`Agent definition '${this.agentName}' not found in registry`);
    }

    // Build the task prompt with any pending messages from the bus
    const pendingMessages = this.config.messageBus.getMessages(this.agentId);
    let fullTask = task;
    if (pendingMessages.length > 0) {
      const msgSummary = pendingMessages
        .map(m => `[${m.from}]: ${m.content}`)
        .join('\n');
      fullTask = `${task}\n\nPending messages from other agents:\n${msgSummary}`;
    }

    const record = await this.config.registry.spawnSubagent(
      this.agentName,
      fullTask,
      { tools: agentDef.tools },
    );

    // Check if abort was signaled while spawnSubagent was running
    if (this.abortController.signal.aborted) {
      throw new Error(`Agent '${this.agentName}' was aborted during execution`);
    }

    return {
      status: record.status,
      result: record.result ?? undefined,
      timeoutMs: record.timeoutMs,
      tokensUsed: record.tokensUsed,
      toolUses: record.toolUses,
    };
  }
}
