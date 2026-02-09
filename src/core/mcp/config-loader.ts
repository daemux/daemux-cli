/**
 * MCP Config Loader
 *
 * Loads MCP server configurations from multiple sources:
 *   1. User settings (~/.daemux/settings.json → mcpServers key)
 *   2. Project .mcp.json (current working directory)
 *
 * Project configs override user settings on key conflicts.
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { MCPConfig } from '@daemux/mcp-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJsonSafe(filePath: string): unknown | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    console.warn(`Failed to parse JSON from ${filePath}`);
    return undefined;
  }
}

function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMCPConfigLike(value: unknown): value is Record<string, unknown> {
  if (!isNonNullObject(value)) return false;
  return typeof value['command'] === 'string' || typeof value['url'] === 'string' || typeof value['type'] === 'string';
}

function extractConfigs(source: unknown): Record<string, MCPConfig> {
  if (!isNonNullObject(source)) return {};
  const result: Record<string, MCPConfig> = {};
  for (const [id, config] of Object.entries(source)) {
    if (isNonNullObject(config)) {
      result[id] = config as MCPConfig;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Source loaders
// ---------------------------------------------------------------------------

/**
 * Loads MCP server configs from ~/.daemux/settings.json (mcpServers key).
 * Returns empty object when the file is missing or malformed.
 *
 * @param settingsPath - Override for testing; defaults to ~/.daemux/settings.json
 */
export function loadFromSettings(
  settingsPath: string = join(homedir(), '.daemux', 'settings.json'),
): Record<string, MCPConfig> {
  const data = readJsonSafe(settingsPath);
  if (!isNonNullObject(data)) return {};
  return extractConfigs(data['mcpServers']);
}

/**
 * Loads MCP server configs from .mcp.json in the given directory.
 * Supports three formats:
 *   1. `{ mcpServers: { "id": {...} } }` - Claude Code format
 *   2. `{ servers: { "id": {...} } }` - plugin format
 *   3. `{ "id": { command: "..." } }` - direct format
 *
 * Returns empty object when the file is missing or malformed.
 *
 * @param projectDir - Override for testing; defaults to process.cwd()
 */
export function loadFromProjectMcpJson(
  projectDir: string = process.cwd(),
): Record<string, MCPConfig> {
  const data = readJsonSafe(join(projectDir, '.mcp.json'));
  if (!isNonNullObject(data)) return {};

  // Format 1: Claude Code format { mcpServers: {...} }
  if (isNonNullObject(data['mcpServers'])) return extractConfigs(data['mcpServers']);

  // Format 2: Plugin format { servers: {...} }
  if (isNonNullObject(data['servers'])) return extractConfigs(data['servers']);

  // Format 3: Direct format { "id": { command: "..." } }
  const directResult: Record<string, MCPConfig> = {};
  for (const [id, value] of Object.entries(data)) {
    if (isMCPConfigLike(value)) {
      directResult[id] = value as MCPConfig;
    }
  }
  return Object.keys(directResult).length > 0 ? directResult : {};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Merges MCP server configs from user settings and project .mcp.json.
 * Project configs override user settings on key conflicts.
 *
 * @param settingsPath - Override for testing; defaults to ~/.daemux/settings.json
 * @param projectDir - Override for testing; defaults to process.cwd()
 */
export function loadMCPConfigs(
  settingsPath?: string,
  projectDir?: string,
): Record<string, MCPConfig> {
  const fromUser = loadFromSettings(settingsPath);
  const fromProject = loadFromProjectMcpJson(projectDir);

  return { ...fromUser, ...fromProject };
}
