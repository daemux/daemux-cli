/** Swarm Coordinator - orchestrates multi-agent swarms for complex tasks. */

import { randomUUID } from 'crypto';
import type { EventBus } from '../event-bus';
import type { LLMProvider } from '../plugin-api-types';
import type { AgentRegistry } from '../agent-registry';
import type { AgentFactory } from '../agent-factory';
import type { MetricsCollector } from '../metrics';
import type { SwarmApprovalHook } from './approval';
import { SwarmMessageBus } from './message-bus';
import { SwarmAgentInstance } from './agent-instance';
import { planAgents } from './planner';
import type { PlannedAgent } from './planner';
import type {
  SwarmConfig,
  SwarmState,
  SwarmAgent,
  SwarmMessage,
  SwarmResult,
  SwarmStatus,
} from './types';
import { DEFAULT_SWARM_CONFIG } from './types';
import { getLogger } from '../../infra/logger';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export { SwarmMessageBus } from './message-bus';
export { SwarmAgentInstance } from './agent-instance';
export { DefaultApprovalHook, InteractiveApprovalHook } from './approval';
export type { SwarmApprovalHook, ApprovalRequest, InteractiveApprovalDeps } from './approval';
export type {
  SwarmConfig,
  SwarmState,
  SwarmAgent,
  SwarmMessage,
  SwarmMessageType,
  SwarmResult,
  SwarmStatus,
  SwarmAgentStatus,
} from './types';

interface SwarmCoordinatorDeps {
  eventBus: EventBus;
  config: SwarmConfig;
  provider: LLMProvider;
  registry: AgentRegistry;
  agentFactory: AgentFactory;
  metricsCollector?: MetricsCollector;
  approvalHook?: SwarmApprovalHook;
}

export class SwarmCoordinator {
  private deps: SwarmCoordinatorDeps;
  private resolvedConfig: Required<SwarmConfig>;
  private state: SwarmState;
  private messageBus: SwarmMessageBus;
  private instances: Map<string, SwarmAgentInstance> = new Map();
  private agentResults: Map<string, string> = new Map();
  private totalTokensUsed = 0;
  private totalToolUses = 0;
  private stopped = false;
  private swarmTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private swarmTimeoutResolve: (() => void) | null = null;
  private eventUnsubscribers: Array<() => void> = [];

  constructor(deps: SwarmCoordinatorDeps) {
    this.deps = deps;
    this.resolvedConfig = {
      maxAgents: deps.config.maxAgents ?? DEFAULT_SWARM_CONFIG.maxAgents,
      timeoutMs: deps.config.timeoutMs ?? DEFAULT_SWARM_CONFIG.timeoutMs,
      maxTokens: deps.config.maxTokens ?? DEFAULT_SWARM_CONFIG.maxTokens,
    };
    this.messageBus = new SwarmMessageBus(deps.eventBus);
    this.state = this.createInitialState();
    this.subscribeToMessages();
  }

  /** Main entry point: analyze task, plan agents, execute, return result. */
  async execute(task: string): Promise<SwarmResult> {
    const startTime = Date.now();
    const logger = getLogger();

    logger.info('Swarm starting', {
      swarmId: this.state.id,
      maxAgents: this.resolvedConfig.maxAgents,
      timeoutMs: this.resolvedConfig.timeoutMs,
    });

    try {
      // Phase 1: Plan agents
      this.state.status = 'planning';
      const plannedAgents = await planAgents(
        this.deps.provider, task, this.resolvedConfig.maxAgents,
      );

      if (this.stopped) return this.buildResult(startTime, 'failed');

      // Phase 1.5: Approval gate (if hook provided)
      if (this.deps.approvalHook) {
        const approved = await this.deps.approvalHook.requestApproval({
          swarmId: this.state.id,
          task,
          agentCount: plannedAgents.length,
        });

        if (!approved) {
          logger.info('Swarm denied by approval hook', { swarmId: this.state.id });
          this.state.status = 'denied';
          return this.buildResult(startTime, 'denied', 'Swarm denied by approval hook');
        }
      }

      // Phase 2: Spawn and run
      this.state.status = 'running';
      await this.spawnAndRun(plannedAgents);

      if (this.stopped) return this.buildResult(startTime, 'failed');

      // Phase 3: Collect results
      const output = this.collectResults();
      this.state.status = 'completed';
      this.state.completedAt = Date.now();

      logger.info('Swarm completed', {
        swarmId: this.state.id,
        agentCount: this.state.agents.size,
        durationMs: Date.now() - startTime,
      });

      return this.buildResult(startTime, 'completed', output);
    } catch (err) {
      const errorMsg = errMsg(err);
      logger.error('Swarm execution failed', { swarmId: this.state.id, error: errorMsg });

      this.state.status = 'failed';
      this.state.completedAt = Date.now();
      return this.buildResult(startTime, 'failed', `Swarm failed: ${errorMsg}`);
    } finally {
      this.cleanup();
    }
  }

  /** Stop the swarm and all its agents. */
  stop(): void {
    this.stopped = true;
    for (const instance of this.instances.values()) {
      instance.stop();
    }
    this.cleanup();
  }

  /** Get the current swarm state (for monitoring). */
  getState(): SwarmState {
    return this.state;
  }

  private async spawnAndRun(plannedAgents: PlannedAgent[]): Promise<void> {
    // Ensure agents exist in registry (create via factory if needed)
    for (const planned of plannedAgents) {
      await this.ensureAgent(planned);
    }

    // Create SwarmAgent entries and instances
    const tasks: Array<Promise<void>> = [];
    for (const planned of plannedAgents) {
      if (this.stopped) return;

      const agentId = randomUUID();
      const swarmAgent: SwarmAgent = {
        id: agentId,
        name: planned.name,
        role: planned.role,
        status: 'idle',
        taskIds: [],
      };

      this.state.agents.set(agentId, swarmAgent);
      this.messageBus.registerAgent(agentId);

      const instance = new SwarmAgentInstance({
        agent: swarmAgent,
        registry: this.deps.registry,
        messageBus: this.messageBus,
        onComplete: this.handleAgentComplete.bind(this),
        onFail: this.handleAgentFail.bind(this),
      });

      this.instances.set(agentId, instance);
      tasks.push(this.runAgentWithTimeout(instance, planned.task));
    }

    // Wait for all agents to finish (with swarm-level timeout)
    await Promise.race([
      Promise.allSettled(tasks),
      this.createSwarmTimeout(),
    ]);
  }

  private async runAgentWithTimeout(
    instance: SwarmAgentInstance,
    task: string,
  ): Promise<void> {
    try {
      await instance.execute(task);
    } catch (err) {
      // Errors are already handled by onFail callback
      getLogger().debug('Swarm agent execution ended with error', {
        agentId: instance.agentId,
        error: errMsg(err),
      });
    }
  }

  private createSwarmTimeout(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.swarmTimeoutResolve = resolve;
      this.swarmTimeoutId = setTimeout(() => {
        this.swarmTimeoutId = null;
        this.swarmTimeoutResolve = null;
        if (!this.stopped) {
          getLogger().warn('Swarm timeout reached', {
            swarmId: this.state.id,
            timeoutMs: this.resolvedConfig.timeoutMs,
          });
          this.state.status = 'timeout';
          this.stop();
        }
        resolve();
      }, this.resolvedConfig.timeoutMs);
    });
  }

  private async ensureAgent(planned: PlannedAgent): Promise<void> {
    if (this.deps.registry.hasAgent(planned.name)) return;

    // Try to create a dynamic agent via the factory
    try {
      await this.deps.agentFactory.createAgent(
        `${planned.role}: ${planned.task}`,
        { tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'] },
      );
    } catch (err) {
      getLogger().warn('Failed to create dynamic agent, falling back to general', {
        name: planned.name,
        error: errMsg(err),
      });
      // If factory fails and 'general' exists, remap the planned name
      if (this.deps.registry.hasAgent('general')) {
        planned.name = 'general';
      }
    }
  }

  private collectResults(): string {
    return Array.from(this.state.agents, ([agentId, agent]) => {
      const result = this.agentResults.get(agentId) || 'No output';
      const statusLabel = agent.status === 'done' ? 'COMPLETED' : agent.status.toUpperCase();
      return `## ${agent.name} (${agent.role}) [${statusLabel}]\n${result}`;
    }).join('\n\n');
  }

  private handleAgentComplete(agentId: string, result: string, tokensUsed?: number, toolUses?: number): void {
    this.agentResults.set(agentId, result);

    if (tokensUsed !== undefined && tokensUsed > 0) {
      this.totalTokensUsed += tokensUsed;
    }
    if (toolUses !== undefined && toolUses > 0) {
      this.totalToolUses += toolUses;
    }

    this.deps.eventBus.emit('swarm:agent-complete', {
      swarmId: this.state.id,
      agentId,
      result: result.slice(0, 200),
    }).catch(() => { /* fire and forget */ });
  }

  private handleAgentFail(agentId: string, error: string): void {
    this.agentResults.set(agentId, `Error: ${error}`);

    this.deps.eventBus.emit('swarm:agent-fail', {
      swarmId: this.state.id,
      agentId,
      error,
    }).catch(() => { /* fire and forget */ });
  }

  private createInitialState(): SwarmState {
    return {
      id: randomUUID(),
      status: 'planning',
      agents: new Map(),
      messages: [],
      startedAt: Date.now(),
    };
  }

  private buildResult(
    startTime: number,
    status: SwarmStatus,
    output?: string,
  ): SwarmResult {
    const durationMs = Date.now() - startTime;

    const result: SwarmResult = {
      swarmId: this.state.id,
      status,
      output: output || this.collectResults(),
      agentResults: new Map(this.agentResults),
      totalTokensUsed: this.totalTokensUsed,
      totalToolUses: this.totalToolUses,
      durationMs,
    };

    // Record swarm metrics if a collector is available
    if (this.deps.metricsCollector && status !== 'denied') {
      this.deps.metricsCollector.recordSwarm({
        swarmId: this.state.id,
        totalTokens: this.totalTokensUsed,
        totalToolUses: this.totalToolUses,
        totalDuration: durationMs,
        agentCount: this.state.agents.size,
        agentMetrics: [],
        timestamp: Date.now(),
      });
    }

    return result;
  }

  private cleanup(): void {
    if (this.swarmTimeoutId) {
      clearTimeout(this.swarmTimeoutId);
      this.swarmTimeoutId = null;
    }
    if (this.swarmTimeoutResolve) {
      this.swarmTimeoutResolve();
      this.swarmTimeoutResolve = null;
    }

    for (const instance of this.instances.values()) {
      if (!instance.isStopped()) {
        instance.stop();
      }
    }

    for (const unsub of this.eventUnsubscribers) {
      unsub();
    }
    this.eventUnsubscribers.length = 0;

    this.messageBus.clear();
    this.instances.clear();
  }

  /** Subscribe to swarm:message and swarm:broadcast events to populate state.messages. */
  private subscribeToMessages(): void {
    const unsubMessage = this.deps.eventBus.on('swarm:message', (payload) => {
      this.state.messages.push({
        id: payload.swarmMessageId,
        from: payload.from,
        to: payload.to,
        type: payload.type as SwarmMessage['type'],
        content: '',
        timestamp: Date.now(),
      });
    });

    const unsubBroadcast = this.deps.eventBus.on('swarm:broadcast', (payload) => {
      this.state.messages.push({
        id: `broadcast-${Date.now()}-${this.state.messages.length}`,
        from: payload.from,
        type: payload.type as SwarmMessage['type'],
        content: '',
        timestamp: Date.now(),
      });
    });

    this.eventUnsubscribers.push(unsubMessage, unsubBroadcast);
  }
}
