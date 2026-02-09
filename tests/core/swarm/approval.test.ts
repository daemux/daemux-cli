/**
 * Swarm Approval Hook Tests
 * Tests DefaultApprovalHook (auto-approve), InteractiveApprovalHook, and
 * SwarmCoordinator integration with denial.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  DefaultApprovalHook,
  InteractiveApprovalHook,
} from '../../../src/core/swarm/approval';
import type { ApprovalRequest } from '../../../src/core/swarm/approval';
import { SwarmCoordinator } from '../../../src/core/swarm';
import { EventBus } from '../../../src/core/event-bus';
import type { AgentDefinition, SubagentRecord } from '../../../src/core/types';
import type { AgentFactory } from '../../../src/core/agent-factory';
import type { AgentRegistry } from '../../../src/core/agent-registry';
import { createReadyMockProvider, type MockLLMProvider } from '../../mocks/mock-llm-provider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApprovalRequest(overrides?: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    swarmId: 'test-swarm-1',
    task: 'Build a REST API with authentication',
    agentCount: 3,
    ...overrides,
  };
}

function makeAgentDef(name: string): AgentDefinition {
  return {
    name,
    description: `Agent ${name}`,
    model: 'inherit',
    tools: ['Read', 'Write', 'Bash'],
    color: 'blue',
    systemPrompt: `You are ${name}.`,
    pluginId: 'core',
  };
}

function makeRecord(overrides?: Partial<SubagentRecord>): SubagentRecord {
  return {
    id: `rec-${Date.now()}`,
    agentName: 'general',
    parentId: null,
    taskDescription: 'task',
    status: 'completed',
    spawnedAt: Date.now(),
    timeoutMs: 300000,
    result: 'Done',
    tokensUsed: 100,
    toolUses: 2,
    completedAt: Date.now(),
    ...overrides,
  };
}

function createMockRegistry(): AgentRegistry {
  const agents = [makeAgentDef('general')];
  const agentMap = new Map(agents.map(a => [a.name, a]));

  return {
    getAgent: (name: string) => agentMap.get(name),
    hasAgent: (name: string) => agentMap.has(name),
    listAgents: () => agents,
    registerAgent: (agent: AgentDefinition) => { agentMap.set(agent.name, agent); },
    spawnSubagent: async (name: string) => {
      return makeRecord({ agentName: name });
    },
    resolveModel: () => 'claude-sonnet-4-20250514',
  } as unknown as AgentRegistry;
}

function createMockFactory(): AgentFactory {
  return {
    createAgent: async (taskDesc: string) => {
      const name = taskDesc.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20);
      return makeAgentDef(`dyn-${name}`);
    },
  } as unknown as AgentFactory;
}

// ---------------------------------------------------------------------------
// Tests: DefaultApprovalHook
// ---------------------------------------------------------------------------

describe('DefaultApprovalHook', () => {
  it('should auto-approve all requests', async () => {
    const hook = new DefaultApprovalHook();
    const request = makeApprovalRequest();

    const result = await hook.requestApproval(request);

    expect(result).toBe(true);
  });

  it('should auto-approve regardless of agent count', async () => {
    const hook = new DefaultApprovalHook();

    const result = await hook.requestApproval(makeApprovalRequest({ agentCount: 100 }));

    expect(result).toBe(true);
  });

  it('should auto-approve with estimated cost', async () => {
    const hook = new DefaultApprovalHook();

    const result = await hook.requestApproval(
      makeApprovalRequest({ estimatedCost: '$5.00' }),
    );

    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: InteractiveApprovalHook
// ---------------------------------------------------------------------------

describe('InteractiveApprovalHook', () => {
  it('should send approval message and return true on yes', async () => {
    const sentMessages: string[] = [];
    const hook = new InteractiveApprovalHook({
      sendMessage: async (msg) => { sentMessages.push(msg); },
      waitForResponse: async () => 'yes',
    });

    const result = await hook.requestApproval(makeApprovalRequest());

    expect(result).toBe(true);
    expect(sentMessages.length).toBe(1);
    expect(sentMessages[0]).toContain('3 agents');
    expect(sentMessages[0]).toContain('Approve?');
  });

  it('should return false on no', async () => {
    const hook = new InteractiveApprovalHook({
      sendMessage: async () => {},
      waitForResponse: async () => 'no',
    });

    const result = await hook.requestApproval(makeApprovalRequest());

    expect(result).toBe(false);
  });

  it('should return true on y (case insensitive)', async () => {
    const hook = new InteractiveApprovalHook({
      sendMessage: async () => {},
      waitForResponse: async () => 'Y',
    });

    const result = await hook.requestApproval(makeApprovalRequest());

    expect(result).toBe(true);
  });

  it('should return true on yes with extra text', async () => {
    const hook = new InteractiveApprovalHook({
      sendMessage: async () => {},
      waitForResponse: async () => 'yes please go ahead',
    });

    const result = await hook.requestApproval(makeApprovalRequest());

    expect(result).toBe(true);
  });

  it('should return false on anything not starting with y', async () => {
    const hook = new InteractiveApprovalHook({
      sendMessage: async () => {},
      waitForResponse: async () => 'nah',
    });

    const result = await hook.requestApproval(makeApprovalRequest());

    expect(result).toBe(false);
  });

  it('should include estimated cost in message when provided', async () => {
    const sentMessages: string[] = [];
    const hook = new InteractiveApprovalHook({
      sendMessage: async (msg) => { sentMessages.push(msg); },
      waitForResponse: async () => 'yes',
    });

    await hook.requestApproval(makeApprovalRequest({ estimatedCost: '$2.50' }));

    expect(sentMessages[0]).toContain('$2.50');
  });

  it('should not include cost when not provided', async () => {
    const sentMessages: string[] = [];
    const hook = new InteractiveApprovalHook({
      sendMessage: async (msg) => { sentMessages.push(msg); },
      waitForResponse: async () => 'yes',
    });

    await hook.requestApproval(makeApprovalRequest());

    expect(sentMessages[0]).not.toContain('Estimated cost');
  });

  it('should handle singular agent count', async () => {
    const sentMessages: string[] = [];
    const hook = new InteractiveApprovalHook({
      sendMessage: async (msg) => { sentMessages.push(msg); },
      waitForResponse: async () => 'yes',
    });

    await hook.requestApproval(makeApprovalRequest({ agentCount: 1 }));

    expect(sentMessages[0]).toContain('1 agent ');
  });

  it('should truncate long task descriptions', async () => {
    const sentMessages: string[] = [];
    const hook = new InteractiveApprovalHook({
      sendMessage: async (msg) => { sentMessages.push(msg); },
      waitForResponse: async () => 'yes',
    });

    const longTask = 'A'.repeat(200);
    await hook.requestApproval(makeApprovalRequest({ task: longTask }));

    // Message should contain a truncated version, not the full 200 chars
    expect(sentMessages[0].length).toBeLessThan(300);
    expect(sentMessages[0]).toContain('...');
  });
});

// ---------------------------------------------------------------------------
// Tests: SwarmCoordinator respects denial
// ---------------------------------------------------------------------------

describe('SwarmCoordinator with approval hook', () => {
  it('should return denied status when approval is rejected', async () => {
    const eventBus = new EventBus();
    const provider = createReadyMockProvider();
    const registry = createMockRegistry();
    const agentFactory = createMockFactory();

    // Plan response
    provider.addTextResponse(JSON.stringify([
      { name: 'general', role: 'Worker', task: 'Do the work' },
    ]));

    const denyingHook = {
      requestApproval: async () => false,
    };

    const coordinator = new SwarmCoordinator({
      eventBus,
      config: { maxAgents: 5, timeoutMs: 60000 },
      provider,
      registry,
      agentFactory,
      approvalHook: denyingHook,
    });

    const result = await coordinator.execute('Some task');

    expect(result.status).toBe('denied');
    expect(result.output).toContain('denied');
  });

  it('should proceed normally when approval is granted', async () => {
    const eventBus = new EventBus();
    const provider = createReadyMockProvider();
    const registry = createMockRegistry();
    const agentFactory = createMockFactory();

    provider.addTextResponse(JSON.stringify([
      { name: 'general', role: 'Worker', task: 'Do the work' },
    ]));

    const approvingHook = {
      requestApproval: async () => true,
    };

    const coordinator = new SwarmCoordinator({
      eventBus,
      config: { maxAgents: 5, timeoutMs: 60000 },
      provider,
      registry,
      agentFactory,
      approvalHook: approvingHook,
    });

    const result = await coordinator.execute('Some task');

    expect(result.status).toBe('completed');
  });

  it('should pass correct request to approval hook', async () => {
    const eventBus = new EventBus();
    const provider = createReadyMockProvider();
    const registry = createMockRegistry();
    const agentFactory = createMockFactory();

    provider.addTextResponse(JSON.stringify([
      { name: 'general', role: 'A', task: 'T1' },
      { name: 'general', role: 'B', task: 'T2' },
    ]));

    let capturedRequest: ApprovalRequest | null = null;
    const capturingHook = {
      requestApproval: async (req: ApprovalRequest) => {
        capturedRequest = req;
        return true;
      },
    };

    const coordinator = new SwarmCoordinator({
      eventBus,
      config: { maxAgents: 5, timeoutMs: 60000 },
      provider,
      registry,
      agentFactory,
      approvalHook: capturingHook,
    });

    await coordinator.execute('Build two features');

    expect(capturedRequest).not.toBeNull();
    expect(capturedRequest!.swarmId).toBeTruthy();
    expect(capturedRequest!.task).toBe('Build two features');
    expect(capturedRequest!.agentCount).toBe(2);
  });
});
