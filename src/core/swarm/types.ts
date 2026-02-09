/** Swarm type definitions for agent coordination, messaging, and lifecycle. */

export interface SwarmConfig {
  /** Maximum number of concurrent agents in a swarm (default: 5) */
  maxAgents?: number;
  /** Swarm-wide timeout in milliseconds (default: 600000 = 10 min) */
  timeoutMs?: number;
  /** Maximum token budget across all agents */
  maxTokens?: number;
}

export const DEFAULT_SWARM_CONFIG: Required<SwarmConfig> = {
  maxAgents: 5,
  timeoutMs: 600_000,
  maxTokens: 500_000,
};

export type SwarmAgentStatus = 'idle' | 'working' | 'done' | 'failed';

export interface SwarmAgent {
  id: string;
  name: string;
  role: string;
  status: SwarmAgentStatus;
  taskIds: string[];
}

export type SwarmMessageType =
  | 'message'
  | 'broadcast'
  | 'shutdown_request'
  | 'shutdown_response';

export interface SwarmMessage {
  id: string;
  from: string;
  to?: string;
  type: SwarmMessageType;
  content: string;
  timestamp: number;
}

export type SwarmStatus =
  | 'planning'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'denied';

export interface SwarmState {
  id: string;
  status: SwarmStatus;
  agents: Map<string, SwarmAgent>;
  messages: SwarmMessage[];
  startedAt: number;
  completedAt?: number;
}

export interface SwarmResult {
  swarmId: string;
  status: SwarmStatus;
  output: string;
  agentResults: Map<string, string>;
  totalTokensUsed: number;
  totalToolUses: number;
  durationMs: number;
}
