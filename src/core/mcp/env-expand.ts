/**
 * Environment Variable Expansion for MCP Configs
 *
 * Replaces ${VAR} and ${VAR:-default} patterns in strings
 * with corresponding process.env values before MCP server connections.
 */

import type { MCPConfig } from '@daemux/mcp-client';

const ENV_VAR_PATTERN = /\$\{([^}:]+?)(?::-([^}]*))?\}/g;

/**
 * Replaces ${VAR} and ${VAR:-default} in a string with env values.
 * Missing variables without defaults resolve to empty string.
 */
export function expandEnvValue(value: string): string {
  return value.replace(ENV_VAR_PATTERN, (_match, varName: string, fallback?: string) => {
    const envValue = process.env[varName];
    if (envValue !== undefined && envValue !== '') {
      return envValue;
    }
    return fallback ?? '';
  });
}

/**
 * Expands env vars in all values of a Record.
 * Returns a new object; the original is not mutated.
 */
export function expandEnvInRecord(record: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = expandEnvValue(value);
  }
  return result;
}

/**
 * Expands env vars across all string fields in an MCPConfig.
 * Handles: command, args, url, env values, header values.
 * Returns a new config; the original is not mutated.
 */
export function expandMCPConfig(config: MCPConfig): MCPConfig {
  return {
    ...config,
    ...(config.command !== undefined && { command: expandEnvValue(config.command) }),
    ...(config.args !== undefined && { args: config.args.map(expandEnvValue) }),
    ...(config.url !== undefined && { url: expandEnvValue(config.url) }),
    ...(config.env !== undefined && { env: expandEnvInRecord(config.env) }),
    ...(config.headers !== undefined && { headers: expandEnvInRecord(config.headers) }),
  };
}
