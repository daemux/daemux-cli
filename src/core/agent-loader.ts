/**
 * Agent Loader - Loads built-in agents from markdown files
 * Parses frontmatter and system prompt from src/agents/*.md files.
 * Called at startup before plugin activation so plugins can reference built-in agents.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import type { AgentDefinition } from './types';

/**
 * Parse YAML-like frontmatter between --- markers.
 * Handles scalar values, inline JSON arrays, and YAML list syntax (- item).
 */
export function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!fmMatch || !fmMatch[1]) {
    return { data: {}, body: content };
  }

  const fmContent = fmMatch[1];
  const body = fmMatch[2] ?? '';
  const data: Record<string, unknown> = {};
  const lines = fmContent.split('\n');

  let currentKey: string | null = null;
  let listItems: string[] | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Check for YAML list item (  - value)
    if (trimmed.startsWith('- ') && currentKey && listItems !== null) {
      listItems.push(trimmed.slice(2).trim());
      continue;
    }

    // Flush any pending list
    if (currentKey && listItems !== null) {
      data[currentKey] = listItems;
      currentKey = null;
      listItems = null;
    }

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    const rawValue = trimmed.slice(colonIndex + 1).trim();

    // Empty value after colon means YAML list follows
    if (rawValue === '') {
      currentKey = key;
      listItems = [];
      continue;
    }

    // Inline JSON array
    if (rawValue.startsWith('[')) {
      try {
        data[key] = JSON.parse(rawValue);
      } catch {
        data[key] = rawValue;
      }
      continue;
    }

    // Booleans
    if (rawValue === 'true') { data[key] = true; continue; }
    if (rawValue === 'false') { data[key] = false; continue; }

    // Strip quotes
    if (rawValue.match(/^["'].*["']$/)) {
      data[key] = rawValue.slice(1, -1);
      continue;
    }

    data[key] = rawValue;
  }

  // Flush final pending list
  if (currentKey && listItems !== null) {
    data[currentKey] = listItems;
  }

  return { data, body };
}

/**
 * Load all built-in agents from a directory of .md files.
 * Returns AgentDefinition[] with pluginId set to 'core'.
 */
export function loadBuiltinAgents(agentsDir?: string): AgentDefinition[] {
  const dir = agentsDir ?? resolve(__dirname, '../agents');

  let files: string[];
  try {
    files = readdirSync(dir).filter(f => f.endsWith('.md'));
  } catch {
    return [];
  }

  const agents: AgentDefinition[] = [];

  for (const file of files) {
    const content = readFileSync(join(dir, file), 'utf-8');
    const { data, body } = parseFrontmatter(content);

    if (!data.name || !data.description) continue;

    const tools = Array.isArray(data.tools) ? (data.tools as string[]) : [];

    agents.push({
      name: data.name as string,
      description: data.description as string,
      model: (data.model as AgentDefinition['model']) || 'inherit',
      tools,
      color: (data.color as AgentDefinition['color']) || 'blue',
      systemPrompt: body.trim(),
      pluginId: 'core',
    });
  }

  return agents;
}
