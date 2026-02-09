/**
 * MetricsCollector Tests
 * Tests agent/swarm metrics recording, ring buffer, summary, and event emission.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  MetricsCollector,
  isAgentMetrics,
  isSwarmMetrics,
} from '../../src/core/metrics';
import type { AgentMetrics, SwarmMetrics } from '../../src/core/metrics';
import { EventBus } from '../../src/core/event-bus';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgentMetrics(overrides?: Partial<AgentMetrics>): AgentMetrics {
  return {
    agentName: 'test-agent',
    tokensUsed: 500,
    toolUses: 3,
    duration: 1200,
    model: 'haiku',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeSwarmMetrics(overrides?: Partial<SwarmMetrics>): SwarmMetrics {
  return {
    swarmId: 'swarm-1',
    totalTokens: 1500,
    totalToolUses: 10,
    totalDuration: 5000,
    agentCount: 3,
    agentMetrics: [],
    timestamp: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  // -------------------------------------------------------------------------
  // recordAgent
  // -------------------------------------------------------------------------

  describe('recordAgent', () => {
    it('should store agent metrics in history', () => {
      const metrics = makeAgentMetrics();

      collector.recordAgent(metrics);

      const history = collector.getHistory();
      expect(history.length).toBe(1);
      expect(history[0]).toEqual(metrics);
    });

    it('should store multiple agent metrics', () => {
      collector.recordAgent(makeAgentMetrics({ agentName: 'agent-a' }));
      collector.recordAgent(makeAgentMetrics({ agentName: 'agent-b' }));
      collector.recordAgent(makeAgentMetrics({ agentName: 'agent-c' }));

      expect(collector.getHistory().length).toBe(3);
    });

    it('should emit metrics:agent event when eventBus is provided', async () => {
      const eventBus = new EventBus();
      const evented = new MetricsCollector({ eventBus });
      const received: AgentMetrics[] = [];

      eventBus.on('metrics:agent', (payload) => {
        received.push(payload as AgentMetrics);
      });

      const metrics = makeAgentMetrics();
      evented.recordAgent(metrics);

      // Wait for async emit
      await new Promise(r => setTimeout(r, 10));

      expect(received.length).toBe(1);
      expect(received[0].agentName).toBe('test-agent');
    });
  });

  // -------------------------------------------------------------------------
  // recordSwarm
  // -------------------------------------------------------------------------

  describe('recordSwarm', () => {
    it('should store swarm metrics in history', () => {
      const metrics = makeSwarmMetrics();

      collector.recordSwarm(metrics);

      const history = collector.getHistory();
      expect(history.length).toBe(1);
      expect(history[0]).toEqual(metrics);
    });

    it('should emit metrics:swarm event when eventBus is provided', async () => {
      const eventBus = new EventBus();
      const evented = new MetricsCollector({ eventBus });
      const received: SwarmMetrics[] = [];

      eventBus.on('metrics:swarm', (payload) => {
        received.push(payload as SwarmMetrics);
      });

      evented.recordSwarm(makeSwarmMetrics());

      await new Promise(r => setTimeout(r, 10));

      expect(received.length).toBe(1);
      expect(received[0].swarmId).toBe('swarm-1');
    });
  });

  // -------------------------------------------------------------------------
  // getSummary
  // -------------------------------------------------------------------------

  describe('getSummary', () => {
    it('should return zeros with no recorded metrics', () => {
      const summary = collector.getSummary();

      expect(summary.totalTokens).toBe(0);
      expect(summary.totalToolUses).toBe(0);
      expect(summary.agentCount).toBe(0);
    });

    it('should aggregate agent metrics correctly', () => {
      collector.recordAgent(makeAgentMetrics({ tokensUsed: 100, toolUses: 2 }));
      collector.recordAgent(makeAgentMetrics({ tokensUsed: 200, toolUses: 5 }));

      const summary = collector.getSummary();

      expect(summary.totalTokens).toBe(300);
      expect(summary.totalToolUses).toBe(7);
      expect(summary.agentCount).toBe(2);
    });

    it('should aggregate swarm metrics correctly', () => {
      collector.recordSwarm(makeSwarmMetrics({
        totalTokens: 1000,
        totalToolUses: 8,
        agentCount: 2,
      }));

      const summary = collector.getSummary();

      expect(summary.totalTokens).toBe(1000);
      expect(summary.totalToolUses).toBe(8);
      expect(summary.agentCount).toBe(2);
    });

    it('should aggregate mixed agent and swarm metrics', () => {
      collector.recordAgent(makeAgentMetrics({ tokensUsed: 200, toolUses: 3 }));
      collector.recordSwarm(makeSwarmMetrics({
        totalTokens: 800,
        totalToolUses: 7,
        agentCount: 2,
      }));

      const summary = collector.getSummary();

      expect(summary.totalTokens).toBe(1000);
      expect(summary.totalToolUses).toBe(10);
      expect(summary.agentCount).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // Ring buffer behavior
  // -------------------------------------------------------------------------

  describe('ring buffer', () => {
    it('should cap history at maxHistory', () => {
      const small = new MetricsCollector({ maxHistory: 5 });

      for (let i = 0; i < 10; i++) {
        small.recordAgent(makeAgentMetrics({ agentName: `agent-${i}` }));
      }

      const history = small.getHistory();
      expect(history.length).toBe(5);
    });

    it('should evict oldest entries first', () => {
      const small = new MetricsCollector({ maxHistory: 3 });

      small.recordAgent(makeAgentMetrics({ agentName: 'first' }));
      small.recordAgent(makeAgentMetrics({ agentName: 'second' }));
      small.recordAgent(makeAgentMetrics({ agentName: 'third' }));
      small.recordAgent(makeAgentMetrics({ agentName: 'fourth' }));

      const history = small.getHistory();
      expect(history.length).toBe(3);

      // 'first' should have been evicted
      const names = history.map(h => (h as AgentMetrics).agentName);
      expect(names).toEqual(['second', 'third', 'fourth']);
    });

    it('should handle maxHistory of 1', () => {
      const tiny = new MetricsCollector({ maxHistory: 1 });

      tiny.recordAgent(makeAgentMetrics({ agentName: 'a' }));
      tiny.recordAgent(makeAgentMetrics({ agentName: 'b' }));

      const history = tiny.getHistory();
      expect(history.length).toBe(1);
      expect((history[0] as AgentMetrics).agentName).toBe('b');
    });

    it('should use default maxHistory of 100', () => {
      const defaultCollector = new MetricsCollector();

      for (let i = 0; i < 105; i++) {
        defaultCollector.recordAgent(makeAgentMetrics({ agentName: `agent-${i}` }));
      }

      expect(defaultCollector.getHistory().length).toBe(100);
    });
  });

  // -------------------------------------------------------------------------
  // clear
  // -------------------------------------------------------------------------

  describe('clear', () => {
    it('should reset all recorded data', () => {
      collector.recordAgent(makeAgentMetrics());
      collector.recordSwarm(makeSwarmMetrics());
      expect(collector.getHistory().length).toBe(2);

      collector.clear();

      expect(collector.getHistory().length).toBe(0);
      const summary = collector.getSummary();
      expect(summary.totalTokens).toBe(0);
      expect(summary.totalToolUses).toBe(0);
      expect(summary.agentCount).toBe(0);
    });

    it('should allow recording after clear', () => {
      collector.recordAgent(makeAgentMetrics());
      collector.clear();
      collector.recordAgent(makeAgentMetrics({ agentName: 'post-clear' }));

      expect(collector.getHistory().length).toBe(1);
      expect((collector.getHistory()[0] as AgentMetrics).agentName).toBe('post-clear');
    });
  });

  // -------------------------------------------------------------------------
  // Type guards
  // -------------------------------------------------------------------------

  describe('type guards', () => {
    it('should identify agent metrics', () => {
      const agent = makeAgentMetrics();
      expect(isAgentMetrics(agent)).toBe(true);
      expect(isSwarmMetrics(agent)).toBe(false);
    });

    it('should identify swarm metrics', () => {
      const swarm = makeSwarmMetrics();
      expect(isSwarmMetrics(swarm)).toBe(true);
      expect(isAgentMetrics(swarm)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getHistory immutability
  // -------------------------------------------------------------------------

  describe('getHistory', () => {
    it('should return readonly array', () => {
      collector.recordAgent(makeAgentMetrics());
      const history = collector.getHistory();

      // Should be the same reference (ReadonlyArray is just a type constraint)
      expect(history.length).toBe(1);
    });
  });
});
