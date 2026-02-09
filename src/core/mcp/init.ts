/**
 * MCP Initialization
 *
 * Startup function that loads configs, connects to MCP servers,
 * and returns tools/executors ready for the agentic loop.
 */

import type { ToolDefinition, ToolResult } from '../types';
import { MCPServerManager } from './server-manager';
import { createMCPToolBridge } from './tool-bridge';
import { loadMCPConfigs } from './config-loader';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

type ToolExecutorFn = (
  toolUseId: string,
  input: Record<string, unknown>,
) => Promise<ToolResult>;

export interface MCPInitResult {
  tools: ToolDefinition[];
  executors: Map<string, ToolExecutorFn>;
  cleanup: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const EMPTY_RESULT: Pick<MCPInitResult, 'tools' | 'executors'> = {
  tools: [],
  executors: new Map(),
};

/**
 * Loads MCP server configurations, connects to all servers, and returns
 * tool definitions with their executor functions for the agentic loop.
 *
 * Safe to call even when no MCP servers are configured -- returns empty
 * tools/executors and a no-op cleanup function.
 */
export async function initMCP(logger: Logger): Promise<MCPInitResult> {
  const configs = loadMCPConfigs();
  const configCount = Object.keys(configs).length;

  if (configCount === 0) {
    logger.info('No MCP server configurations found');
    return { ...EMPTY_RESULT, cleanup: async () => {} };
  }

  logger.info(`Found ${configCount} MCP server configuration(s)`);

  const manager = new MCPServerManager(logger);
  const result = await manager.connectAll(configs);
  const cleanup = async () => manager.disconnectAll();

  if (result.connected.length > 0) {
    logger.info(`MCP servers connected: ${result.connected.join(', ')}`);
  }
  for (const failure of result.failed) {
    logger.warn(`MCP server '${failure.id}' failed to connect`, { error: failure.error });
  }

  if (result.connected.length === 0) {
    logger.warn('No MCP servers connected successfully');
    return { ...EMPTY_RESULT, cleanup };
  }

  const bridge = createMCPToolBridge(manager);
  logger.info(`${bridge.tools.length} MCP tool(s) available`);

  return { tools: bridge.tools, executors: bridge.executors, cleanup };
}
