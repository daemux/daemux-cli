/**
 * Agent Loader - Loads built-in agents from markdown files
 * Parses frontmatter and system prompt from src/agents/*.md files.
 * Called at startup before plugin activation so plugins can reference built-in agents.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import type { AgentDefinition } from './types';

/** Parse a scalar YAML value: booleans, JSON arrays, quoted strings, or plain text. */
function parseScalarValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  if (raw.startsWith('[')) {
    try { return JSON.parse(raw); } catch { return raw; }
  }

  if (raw.match(/^(["']).*\1$/)) return raw.slice(1, -1);

  return raw;
}

/**
 * Parse YAML-like frontmatter between --- markers.
 * Handles scalar values, inline JSON arrays, and YAML list syntax (- item).
 */
export function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const fmMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/);
  if (!fmMatch || !fmMatch[1]) {
    return { data: {}, body: content };
  }

  const data: Record<string, unknown> = {};
  const lines = fmMatch[1].split(/\r?\n/);

  let currentKey: string | null = null;
  let listItems: string[] | null = null;

  /** Flush a pending YAML list into data and reset state. */
  function flushList(): void {
    if (currentKey && listItems !== null) {
      data[currentKey] = listItems;
      currentKey = null;
      listItems = null;
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // YAML list item (  - value)
    if (trimmed.startsWith('- ') && currentKey && listItems !== null) {
      listItems.push(trimmed.slice(2).trim());
      continue;
    }

    flushList();

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

    data[key] = parseScalarValue(rawValue);
  }

  flushList();

  return { data, body: fmMatch[2] ?? '' };
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
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    if (stat.size > 65536) continue; // skip files > 64KB

    const content = readFileSync(filePath, 'utf-8');
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
