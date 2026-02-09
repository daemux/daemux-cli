/**
 * Context Window Display
 * Renders context usage breakdown with colored progress bar
 */

import { bold, dim, color, getTerminalWidth } from './utils';
import { BUILTIN_TOOLS } from '../core/loop';
import type { AgenticLoop } from '../core/loop';
import type { ToolDefinition } from '../core/types';
import type { ColorName } from './utils';

// ---------------------------------------------------------------------------
// Token Estimation Helpers
// ---------------------------------------------------------------------------

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function formatTokens(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return String(n);
}

// ---------------------------------------------------------------------------
// Progress Bar
// ---------------------------------------------------------------------------

interface BarCategory {
  tokens: number;
  color: ColorName;
}

export function renderProgressBar(
  categories: BarCategory[],
  total: number,
  width: number,
): string {
  if (total <= 0 || width <= 0) return '';

  let remaining = width;
  const segments: string[] = [];

  for (const cat of categories) {
    const chars = Math.round((cat.tokens / total) * width);
    const clamped = Math.min(chars, remaining);
    if (clamped > 0) {
      segments.push(color('\u2588'.repeat(clamped), cat.color));
      remaining -= clamped;
    }
  }

  if (remaining > 0) {
    segments.push(dim('\u00B7'.repeat(remaining)));
  }

  return segments.join('');
}

// ---------------------------------------------------------------------------
// Category Row Formatting
// ---------------------------------------------------------------------------

interface DisplayCategory {
  bullet: string;
  label: string;
  tokens: number;
  percentage: number;
}

function formatCategoryRow(cat: DisplayCategory, maxLabel: number): string {
  const paddedLabel = cat.label.padEnd(maxLabel);
  const tokenStr = formatTokens(cat.tokens).padStart(8);
  const pctStr = `${cat.percentage.toFixed(1)}%`.padStart(6);
  return `  ${cat.bullet} ${paddedLabel}${tokenStr}${pctStr}`;
}

// ---------------------------------------------------------------------------
// Full Display Renderer
// ---------------------------------------------------------------------------

interface ContextDisplayInput {
  sessionId: string | null;
  effectiveContextWindow: number;
  compactionThreshold: number;
  systemPromptText: string;
  agentContextText: string | null;
  messageTokens: number;
  messageCount: number;
}

/** Safe percentage: returns 0 when total is zero. */
function pct(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0;
}

interface TokenBreakdown {
  systemOnlyTokens: number;
  agentTokens: number;
  builtinToolTokens: number;
  mcpToolTokens: number;
  mcpToolCount: number;
  msgTokens: number;
  usedTokens: number;
  compactionBuffer: number;
  freeTokens: number;
}

function computeTokenBreakdown(info: ContextDisplayInput, tools: ToolDefinition[]): TokenBreakdown {
  const total = info.effectiveContextWindow;
  const agentTokens = info.agentContextText ? estimateTokens(info.agentContextText) : 0;
  const systemOnlyTokens = Math.max(0, estimateTokens(info.systemPromptText) - agentTokens);

  const builtinNames = new Set(BUILTIN_TOOLS.map(t => t.name));
  const builtinToolList = tools.filter(t => builtinNames.has(t.name));
  const mcpToolList = tools.filter(t => !builtinNames.has(t.name));

  const builtinToolTokens = estimateTokens(JSON.stringify(builtinToolList));
  const mcpToolTokens = mcpToolList.length > 0 ? estimateTokens(JSON.stringify(mcpToolList)) : 0;
  const msgTokens = info.messageTokens;

  const usedTokens = systemOnlyTokens + agentTokens + builtinToolTokens + mcpToolTokens + msgTokens;
  const compactionBuffer = Math.round(total * (1 - info.compactionThreshold));
  const freeTokens = Math.max(0, total - usedTokens - compactionBuffer);

  return {
    systemOnlyTokens, agentTokens, builtinToolTokens,
    mcpToolTokens, mcpToolCount: mcpToolList.length,
    msgTokens, usedTokens, compactionBuffer, freeTokens,
  };
}

function buildCategories(b: TokenBreakdown, total: number, messageCount: number): DisplayCategory[] {
  const cats: DisplayCategory[] = [
    { bullet: color('\u25CF', 'cyan'), label: 'System prompt', tokens: b.systemOnlyTokens, percentage: pct(b.systemOnlyTokens, total) },
  ];

  if (b.agentTokens > 0) {
    cats.push({ bullet: color('\u25CF', 'blue'), label: 'AGENT.md context', tokens: b.agentTokens, percentage: pct(b.agentTokens, total) });
  }

  cats.push({ bullet: color('\u25CF', 'magenta'), label: 'Built-in tools', tokens: b.builtinToolTokens, percentage: pct(b.builtinToolTokens, total) });

  if (b.mcpToolTokens > 0) {
    cats.push({ bullet: color('\u25CF', 'yellow'), label: `MCP tools (${b.mcpToolCount})`, tokens: b.mcpToolTokens, percentage: pct(b.mcpToolTokens, total) });
  }

  cats.push(
    { bullet: color('\u25CF', 'green'), label: `Messages (${messageCount})`, tokens: b.msgTokens, percentage: pct(b.msgTokens, total) },
    { bullet: '\u25CB', label: 'Compaction buffer', tokens: b.compactionBuffer, percentage: pct(b.compactionBuffer, total) },
    { bullet: dim('\u00B7'), label: 'Free space', tokens: b.freeTokens, percentage: pct(b.freeTokens, total) },
  );

  return cats;
}

export function renderContextDisplay(
  info: ContextDisplayInput,
  tools: ToolDefinition[],
): string {
  const total = info.effectiveContextWindow;
  const threshold = info.compactionThreshold;
  const b = computeTokenBreakdown(info, tools);

  const barWidth = Math.min(60, getTerminalWidth() - 6);
  const bar = renderProgressBar([
    { tokens: b.systemOnlyTokens, color: 'cyan' },
    { tokens: b.agentTokens, color: 'blue' },
    { tokens: b.builtinToolTokens, color: 'magenta' },
    { tokens: b.mcpToolTokens, color: 'yellow' },
    { tokens: b.msgTokens, color: 'green' },
    { tokens: b.compactionBuffer, color: 'gray' },
  ], total, barWidth);

  const categories = buildCategories(b, total, info.messageCount);
  const maxLabel = Math.max(...categories.map(c => c.label.length));
  const compactionTrigger = Math.round(total * threshold);

  const lines: string[] = [
    '',
    `  ${bold('Context Window Usage')}`,
    `  ${'━'.repeat(20)}`,
    '',
    `  [${bar}]`,
    `   ${formatTokens(b.usedTokens)} / ${formatTokens(total)} tokens (${pct(b.usedTokens, total).toFixed(1)}%)`,
    '',
    ...categories.map(c => formatCategoryRow(c, maxLabel)),
    '',
    dim(`  Compaction triggers at ${formatTokens(compactionTrigger)} tokens (${Math.round(threshold * 100)}%)`),
    '',
  ];

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Gather and Display (entry point)
// ---------------------------------------------------------------------------

export async function gatherAndDisplay(
  loop: AgenticLoop,
  tools: ToolDefinition[],
): Promise<void> {
  const info = await loop.getContextInfo();
  const output = renderContextDisplay(info, tools);
  console.log(output);
}
