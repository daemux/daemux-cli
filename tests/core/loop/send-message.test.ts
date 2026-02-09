/**
 * SendMessage Tool Tests
 * Tests the SendMessage tool for inter-agent communication within a swarm.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  sendMessageTool,
  createSendMessageTool,
} from '../../../src/core/loop/tools/send-message';
import type { SendMessageDeps } from '../../../src/core/loop/tools/send-message';
import { SwarmMessageBus } from '../../../src/core/swarm/message-bus';
import { EventBus } from '../../../src/core/event-bus';
import type { SwarmAgent } from '../../../src/core/swarm/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgent(id: string, name: string): SwarmAgent {
  return {
    id,
    name,
    role: `${name} role`,
    status: 'working',
    taskIds: [],
  };
}

function createDeps(agentId = 'agent-1'): {
  deps: SendMessageDeps;
  messageBus: SwarmMessageBus;
  agents: Map<string, SwarmAgent>;
} {
  const eventBus = new EventBus();
  const messageBus = new SwarmMessageBus(eventBus);
  const agents = new Map<string, SwarmAgent>();

  const agent1 = makeAgent('agent-1', 'builder');
  const agent2 = makeAgent('agent-2', 'reviewer');
  const agent3 = makeAgent('agent-3', 'tester');

  agents.set('agent-1', agent1);
  agents.set('agent-2', agent2);
  agents.set('agent-3', agent3);

  messageBus.registerAgent('agent-1');
  messageBus.registerAgent('agent-2');
  messageBus.registerAgent('agent-3');

  const deps: SendMessageDeps = {
    messageBus,
    agentId,
    swarmAgents: () => agents,
  };

  return { deps, messageBus, agents };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SendMessage Tool', () => {
  // -----------------------------------------------------------------------
  // Tool Definition
  // -----------------------------------------------------------------------

  describe('Tool Definition', () => {
    it('should have correct name', () => {
      expect(sendMessageTool.name).toBe('SendMessage');
    });

    it('should require type and content', () => {
      expect(sendMessageTool.inputSchema.required).toEqual(['type', 'content']);
    });

    it('should be concurrency safe', () => {
      expect(sendMessageTool.isConcurrencySafe).toBe(true);
    });

    it('should have a description', () => {
      expect(sendMessageTool.description.length).toBeGreaterThan(10);
    });
  });

  // -----------------------------------------------------------------------
  // Factory
  // -----------------------------------------------------------------------

  describe('createSendMessageTool', () => {
    it('should return definition and executor', () => {
      const { deps } = createDeps();
      const { definition, execute } = createSendMessageTool(deps);

      expect(definition).toBe(sendMessageTool);
      expect(typeof execute).toBe('function');
    });
  });

  // -----------------------------------------------------------------------
  // Direct Message
  // -----------------------------------------------------------------------

  describe('direct message', () => {
    it('should send a message to a recipient by name', async () => {
      const { deps, messageBus } = createDeps('agent-1');
      const { execute } = createSendMessageTool(deps);

      const res = await execute('tu-1', {
        type: 'message',
        recipient: 'reviewer',
        content: 'Please review my code',
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain("sent to 'reviewer'");

      const messages = messageBus.getMessages('agent-2');
      expect(messages).toHaveLength(1);
      expect(messages[0]!.content).toBe('Please review my code');
      expect(messages[0]!.from).toBe('agent-1');
    });

    it('should return error for unknown recipient', async () => {
      const { deps } = createDeps();
      const { execute } = createSendMessageTool(deps);

      const res = await execute('tu-2', {
        type: 'message',
        recipient: 'nonexistent',
        content: 'Hello',
      });

      expect(res.isError).toBe(true);
      expect(res.content).toContain('not found');
      expect(res.content).toContain('Available');
    });

    it('should return error when recipient is missing', async () => {
      const { deps } = createDeps();
      const { execute } = createSendMessageTool(deps);

      const res = await execute('tu-3', {
        type: 'message',
        content: 'Hello',
      });

      expect(res.isError).toBe(true);
      expect(res.content).toContain('recipient is required');
    });

    it('should return error when recipient is empty string', async () => {
      const { deps } = createDeps();
      const { execute } = createSendMessageTool(deps);

      const res = await execute('tu-4', {
        type: 'message',
        recipient: '',
        content: 'Hello',
      });

      expect(res.isError).toBe(true);
      expect(res.content).toContain('recipient is required');
    });
  });

  // -----------------------------------------------------------------------
  // Broadcast
  // -----------------------------------------------------------------------

  describe('broadcast', () => {
    it('should broadcast to all agents', async () => {
      const { deps, messageBus } = createDeps('agent-1');
      const { execute } = createSendMessageTool(deps);

      const res = await execute('tu-5', {
        type: 'broadcast',
        content: 'Attention everyone: deployment starting',
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('Broadcast sent to 2 agent(s)');

      // agent-2 and agent-3 should have the message, agent-1 should not
      expect(messageBus.hasMessages('agent-1')).toBe(false);
      expect(messageBus.hasMessages('agent-2')).toBe(true);
      expect(messageBus.hasMessages('agent-3')).toBe(true);
    });

    it('should not require recipient for broadcast', async () => {
      const { deps } = createDeps('agent-1');
      const { execute } = createSendMessageTool(deps);

      const res = await execute('tu-6', {
        type: 'broadcast',
        content: 'Hello all',
      });

      expect(res.isError).toBeFalsy();
    });
  });

  // -----------------------------------------------------------------------
  // Shutdown Request
  // -----------------------------------------------------------------------

  describe('shutdown_request', () => {
    it('should send a shutdown request to a specific agent', async () => {
      const { deps, messageBus } = createDeps('agent-1');
      const { execute } = createSendMessageTool(deps);

      const res = await execute('tu-7', {
        type: 'shutdown_request',
        recipient: 'reviewer',
        content: 'Please stop working',
      });

      expect(res.isError).toBeFalsy();
      expect(res.content).toContain('Shutdown request');

      const messages = messageBus.getMessages('agent-2');
      expect(messages).toHaveLength(1);
      expect(messages[0]!.type).toBe('shutdown_request');
    });

    it('should require recipient for shutdown_request', async () => {
      const { deps } = createDeps();
      const { execute } = createSendMessageTool(deps);

      const res = await execute('tu-8', {
        type: 'shutdown_request',
        content: 'Stop',
      });

      expect(res.isError).toBe(true);
      expect(res.content).toContain('recipient is required');
    });
  });

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

  describe('validation', () => {
    it('should return error for empty content', async () => {
      const { deps } = createDeps();
      const { execute } = createSendMessageTool(deps);

      const res = await execute('tu-9', {
        type: 'message',
        recipient: 'reviewer',
        content: '',
      });

      expect(res.isError).toBe(true);
      expect(res.content).toContain('content is required');
    });

    it('should return error for missing content', async () => {
      const { deps } = createDeps();
      const { execute } = createSendMessageTool(deps);

      const res = await execute('tu-10', {
        type: 'message',
        recipient: 'reviewer',
      });

      expect(res.isError).toBe(true);
      expect(res.content).toContain('content is required');
    });

    it('should return error for invalid type', async () => {
      const { deps } = createDeps();
      const { execute } = createSendMessageTool(deps);

      const res = await execute('tu-11', {
        type: 'invalid_type',
        content: 'Hello',
      });

      expect(res.isError).toBe(true);
      expect(res.content).toContain('type must be');
    });

    it('should return error for missing type', async () => {
      const { deps } = createDeps();
      const { execute } = createSendMessageTool(deps);

      const res = await execute('tu-12', {
        content: 'Hello',
      });

      expect(res.isError).toBe(true);
      expect(res.content).toContain('type must be');
    });

    it('should trim whitespace from content', async () => {
      const { deps, messageBus } = createDeps('agent-1');
      const { execute } = createSendMessageTool(deps);

      await execute('tu-13', {
        type: 'message',
        recipient: 'reviewer',
        content: '  trimmed message  ',
      });

      const messages = messageBus.getMessages('agent-2');
      expect(messages[0]!.content).toBe('trimmed message');
    });
  });
});
