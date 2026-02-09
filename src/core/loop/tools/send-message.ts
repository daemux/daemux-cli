/** SendMessage tool for inter-agent communication within a swarm. */

import type { ToolDefinition, ToolResult } from '../../types';
import type { SwarmMessageBus } from '../../swarm/message-bus';
import type { SwarmAgent } from '../../swarm/types';
import { result } from './helpers';

export interface SendMessageDeps {
  messageBus: SwarmMessageBus;
  agentId: string;
  swarmAgents: () => Map<string, SwarmAgent>;
}

const VALID_TYPES = ['message', 'broadcast', 'shutdown_request'] as const;

export const sendMessageTool: ToolDefinition = {
  name: 'SendMessage',
  description:
    'Send a message to another agent in the swarm. ' +
    'Use type "message" for direct messages (requires recipient). ' +
    'Use type "broadcast" to send to all agents. ' +
    'Use type "shutdown_request" to ask an agent to stop.',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Message type: "message", "broadcast", or "shutdown_request".',
      },
      recipient: {
        type: 'string',
        description: 'Agent name to send to (required for "message" and "shutdown_request").',
      },
      content: {
        type: 'string',
        description: 'The message content to send.',
      },
    },
    required: ['type', 'content'],
  },
  isConcurrencySafe: true,
};

export function createSendMessageTool(deps: SendMessageDeps): {
  definition: ToolDefinition;
  execute: (toolUseId: string, input: Record<string, unknown>) => Promise<ToolResult>;
} {
  const execute = async (
    toolUseId: string,
    input: Record<string, unknown>,
  ): Promise<ToolResult> => {
    const type = input.type as string | undefined;
    const recipient = input.recipient as string | undefined;
    const content = input.content as string | undefined;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return result(toolUseId, 'Error: content is required and must be a non-empty string', true);
    }

    if (!type || !(VALID_TYPES as readonly string[]).includes(type)) {
      return result(toolUseId, `Error: type must be one of: ${VALID_TYPES.join(', ')}`, true);
    }

    return executeSendMessage(toolUseId, { type, recipient, content: content.trim() }, deps);
  };

  return { definition: sendMessageTool, execute };
}

async function executeSendMessage(
  toolUseId: string,
  input: { type: string; recipient?: string; content: string },
  deps: SendMessageDeps,
): Promise<ToolResult> {
  const { type, recipient, content } = input;

  if (type === 'broadcast') {
    deps.messageBus.broadcast(deps.agentId, content);
    const agentCount = deps.messageBus.agentCount() - 1;
    return result(toolUseId, `Broadcast sent to ${agentCount} agent(s)`);
  }

  // Direct message or shutdown_request: need a recipient
  if (!recipient || typeof recipient !== 'string' || recipient.trim().length === 0) {
    return result(toolUseId, `Error: recipient is required for type "${type}"`, true);
  }

  const agents = deps.swarmAgents();
  const targetAgent = findAgentByName(agents, recipient.trim());

  if (!targetAgent) {
    const available = Array.from(agents.values()).map(a => a.name).join(', ');
    return result(
      toolUseId,
      `Error: Agent '${recipient}' not found. Available: ${available || 'none'}`,
      true,
    );
  }

  const messageType = type === 'shutdown_request' ? 'shutdown_request' : 'message';

  deps.messageBus.send({
    id: '',
    from: deps.agentId,
    to: targetAgent.id,
    type: messageType as 'message' | 'shutdown_request',
    content,
    timestamp: Date.now(),
  });

  const label = type === 'shutdown_request' ? 'Shutdown request' : 'Message';
  return result(toolUseId, `${label} sent to '${targetAgent.name}'`);
}

function findAgentByName(
  agents: Map<string, SwarmAgent>,
  name: string,
): SwarmAgent | undefined {
  for (const agent of agents.values()) {
    if (agent.name === name) return agent;
  }
  return undefined;
}
