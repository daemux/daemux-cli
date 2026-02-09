/**
 * MCP Module — barrel export
 *
 * Re-exports all public symbols from the MCP subsystem so consumers
 * can import everything from a single path: `import { initMCP } from './mcp'`.
 */

export { expandEnvValue, expandEnvInRecord, expandMCPConfig } from './env-expand';
export { MCPServerManager } from './server-manager';
export type { MCPServerManagerDeps, ConnectAllResult } from './server-manager';
export { createMCPToolBridge } from './tool-bridge';
export type { MCPServerManagerLike, MCPToolBridge } from './tool-bridge';
export { loadMCPConfigs, loadFromSettings, loadFromProjectMcpJson } from './config-loader';
export { initMCP } from './init';
export type { MCPInitResult } from './init';
