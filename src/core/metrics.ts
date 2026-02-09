/**
 * Agent Metrics & Cost Tracking
 * Tracks tokens, tool usage, and duration per agent and per swarm.
 * Uses a ring buffer to cap memory usage.
 */

import type { EventBus, EventName } from './event-bus';
import { getLogger } from '../infra/logger';

export interface AgentMetrics {
  agentName: string;
  tokensUsed: number;
  toolUses: number;
  duration: number;       // milliseconds
  model: string;
  timestamp: number;
}

export interface SwarmMetrics {
  swarmId: string;
  totalTokens: number;
  totalToolUses: number;
  totalDuration: number;
  agentCount: number;
  agentMetrics: AgentMetrics[];
  timestamp: number;
}

export interface MetricsSummary {
  totalTokens: number;
  totalToolUses: number;
  agentCount: number;
}

export type MetricsEntry = AgentMetrics | SwarmMetrics;

export function isAgentMetrics(entry: MetricsEntry): entry is AgentMetrics {
  return 'agentName' in entry && !('swarmId' in entry);
}

export function isSwarmMetrics(entry: MetricsEntry): entry is SwarmMetrics {
  return 'swarmId' in entry;
}

const DEFAULT_MAX_HISTORY = 100;

export class MetricsCollector {
  private history: MetricsEntry[] = [];
  private maxHistory: number;
  private eventBus: EventBus | null;

  constructor(options?: { maxHistory?: number; eventBus?: EventBus }) {
    this.maxHistory = options?.maxHistory ?? DEFAULT_MAX_HISTORY;
    this.eventBus = options?.eventBus ?? null;
  }

  /** Record metrics for a single agent execution. */
  recordAgent(metrics: AgentMetrics): void {
    this.record(metrics, 'metrics:agent', {
      agentName: metrics.agentName,
      tokensUsed: metrics.tokensUsed,
      toolUses: metrics.toolUses,
      durationMs: metrics.duration,
    });
  }

  /** Record metrics for a swarm execution. */
  recordSwarm(metrics: SwarmMetrics): void {
    this.record(metrics, 'metrics:swarm', {
      swarmId: metrics.swarmId,
      totalTokens: metrics.totalTokens,
      agentCount: metrics.agentCount,
      totalDurationMs: metrics.totalDuration,
    });
  }

  /** Get the full history of recorded metrics. */
  getHistory(): ReadonlyArray<MetricsEntry> {
    return this.history;
  }

  /** Get aggregate summary of all recorded metrics. */
  getSummary(): MetricsSummary {
    let totalTokens = 0;
    let totalToolUses = 0;
    let agentCount = 0;

    for (const entry of this.history) {
      if (isAgentMetrics(entry)) {
        totalTokens += entry.tokensUsed;
        totalToolUses += entry.toolUses;
        agentCount += 1;
      } else if (isSwarmMetrics(entry)) {
        totalTokens += entry.totalTokens;
        totalToolUses += entry.totalToolUses;
        agentCount += entry.agentCount;
      }
    }

    return { totalTokens, totalToolUses, agentCount };
  }

  /** Clear all recorded metrics. */
  clear(): void {
    this.history.length = 0;
  }

  /** Push entry into ring buffer, log, and emit event. */
  private record(entry: MetricsEntry, event: EventName, logContext: Record<string, unknown>): void {
    if (this.history.length >= this.maxHistory) {
      this.history.shift();
    }
    this.history.push(entry);

    getLogger().debug(`${isAgentMetrics(entry) ? 'Agent' : 'Swarm'} metrics recorded`, logContext);

    this.eventBus?.emit(event, entry as never)
      .catch(() => { /* fire and forget */ });
  }
}
