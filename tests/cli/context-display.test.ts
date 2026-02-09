/**
 * Context Display Unit Tests
 * Tests token estimation, formatting, progress bar, and display rendering
 */

import { describe, it, expect } from 'bun:test';
import {
  estimateTokens,
  formatTokens,
  renderProgressBar,
  renderContextDisplay,
} from '../../src/cli/context-display';
import { stripAnsi } from '../../src/cli/utils';

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe('estimateTokens', () => {
  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('should return 0 for null-ish input', () => {
    expect(estimateTokens(null as unknown as string)).toBe(0);
    expect(estimateTokens(undefined as unknown as string)).toBe(0);
  });

  it('should estimate "hello" as 2 tokens (5 chars / 4 = 1.25, ceil = 2)', () => {
    expect(estimateTokens('hello')).toBe(2);
  });

  it('should estimate 100 chars as 25 tokens', () => {
    const text = 'a'.repeat(100);
    expect(estimateTokens(text)).toBe(25);
  });

  it('should ceil non-integer results', () => {
    // 5 chars => 5/4 = 1.25 => ceil = 2
    expect(estimateTokens('abcde')).toBe(2);
    // 7 chars => 7/4 = 1.75 => ceil = 2
    expect(estimateTokens('abcdefg')).toBe(2);
  });

  it('should handle single character', () => {
    expect(estimateTokens('a')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// formatTokens
// ---------------------------------------------------------------------------

describe('formatTokens', () => {
  it('should return "0" for zero', () => {
    expect(formatTokens(0)).toBe('0');
  });

  it('should return raw number below 1000', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1)).toBe('1');
    expect(formatTokens(500)).toBe('500');
  });

  it('should format 1000 as "1.0k"', () => {
    expect(formatTokens(1000)).toBe('1.0k');
  });

  it('should format 1500 as "1.5k"', () => {
    expect(formatTokens(1500)).toBe('1.5k');
  });

  it('should format 180000 as "180.0k"', () => {
    expect(formatTokens(180000)).toBe('180.0k');
  });

  it('should format 12345 as "12.3k"', () => {
    expect(formatTokens(12345)).toBe('12.3k');
  });
});

// ---------------------------------------------------------------------------
// renderProgressBar
// ---------------------------------------------------------------------------

describe('renderProgressBar', () => {
  it('should return empty string for zero total', () => {
    expect(renderProgressBar([{ tokens: 10, color: 'cyan' }], 0, 20)).toBe('');
  });

  it('should return empty string for zero width', () => {
    expect(renderProgressBar([{ tokens: 10, color: 'cyan' }], 100, 0)).toBe('');
  });

  it('should contain block characters for non-zero categories', () => {
    const result = renderProgressBar(
      [{ tokens: 50, color: 'cyan' }],
      100,
      20,
    );
    const plain = stripAnsi(result);
    expect(plain).toContain('\u2588');
  });

  it('should contain dot characters for free space', () => {
    const result = renderProgressBar(
      [{ tokens: 10, color: 'cyan' }],
      100,
      20,
    );
    const plain = stripAnsi(result);
    expect(plain).toContain('\u00B7');
  });

  it('should fill entire bar when usage is at 100%', () => {
    const result = renderProgressBar(
      [{ tokens: 100, color: 'green' }],
      100,
      20,
    );
    const plain = stripAnsi(result);
    const blocks = (plain.match(/\u2588/g) ?? []).length;
    expect(blocks).toBe(20);
    expect(plain).not.toContain('\u00B7');
  });

  it('should render multiple colored segments', () => {
    const result = renderProgressBar(
      [
        { tokens: 25, color: 'cyan' },
        { tokens: 25, color: 'green' },
      ],
      100,
      20,
    );
    const plain = stripAnsi(result);
    const blocks = (plain.match(/\u2588/g) ?? []).length;
    // 25% of 20 = 5 blocks each = 10 total
    expect(blocks).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// renderContextDisplay
// ---------------------------------------------------------------------------

describe('renderContextDisplay', () => {
  const baseInfo = {
    sessionId: 'test-session-id',
    effectiveContextWindow: 180000,
    compactionThreshold: 0.8,
    systemPromptText: 'You are a helpful AI assistant.',
    agentContextText: null,
    messageTokens: 5000,
    messageCount: 12,
  };

  const mockTools = [
    { name: 'Read', description: 'Read files', inputSchema: { type: 'object' as const, properties: {} } },
    { name: 'Write', description: 'Write files', inputSchema: { type: 'object' as const, properties: {} } },
    { name: 'Bash', description: 'Run commands', inputSchema: { type: 'object' as const, properties: {} } },
    { name: 'Edit', description: 'Edit files', inputSchema: { type: 'object' as const, properties: {} } },
    { name: 'Glob', description: 'Find files', inputSchema: { type: 'object' as const, properties: {} } },
    { name: 'Grep', description: 'Search content', inputSchema: { type: 'object' as const, properties: {} } },
  ];

  it('should include header text', () => {
    const output = stripAnsi(renderContextDisplay(baseInfo, mockTools));
    expect(output).toContain('Context Window Usage');
  });

  it('should include percentage', () => {
    const output = stripAnsi(renderContextDisplay(baseInfo, mockTools));
    expect(output).toContain('%');
    expect(output).toContain('180.0k tokens');
  });

  it('should include System prompt label', () => {
    const output = stripAnsi(renderContextDisplay(baseInfo, mockTools));
    expect(output).toContain('System prompt');
  });

  it('should include Built-in tools label', () => {
    const output = stripAnsi(renderContextDisplay(baseInfo, mockTools));
    expect(output).toContain('Built-in tools');
  });

  it('should include Messages label with count', () => {
    const output = stripAnsi(renderContextDisplay(baseInfo, mockTools));
    expect(output).toContain('Messages (12)');
  });

  it('should include Compaction buffer label', () => {
    const output = stripAnsi(renderContextDisplay(baseInfo, mockTools));
    expect(output).toContain('Compaction buffer');
  });

  it('should include Free space label', () => {
    const output = stripAnsi(renderContextDisplay(baseInfo, mockTools));
    expect(output).toContain('Free space');
  });

  it('should include compaction trigger info', () => {
    const output = stripAnsi(renderContextDisplay(baseInfo, mockTools));
    expect(output).toContain('Compaction triggers at');
    expect(output).toContain('144.0k tokens');
    expect(output).toContain('80%');
  });

  it('should omit AGENT.md row when agentContextText is null', () => {
    const output = stripAnsi(renderContextDisplay(baseInfo, mockTools));
    expect(output).not.toContain('AGENT.md');
  });

  it('should include AGENT.md row when agentContextText is present', () => {
    const infoWithAgent = {
      ...baseInfo,
      agentContextText: 'Some project context content for the agent to use.',
    };
    const output = stripAnsi(renderContextDisplay(infoWithAgent, mockTools));
    expect(output).toContain('AGENT.md context');
  });

  it('should omit MCP tools row when no MCP tools exist', () => {
    const output = stripAnsi(renderContextDisplay(baseInfo, mockTools));
    expect(output).not.toContain('MCP tools');
  });

  it('should include MCP tools row when MCP tools exist', () => {
    const toolsWithMcp = [
      ...mockTools,
      { name: 'custom-mcp-tool', description: 'A custom tool', inputSchema: { type: 'object' as const, properties: {} } },
    ];
    const output = stripAnsi(renderContextDisplay(baseInfo, toolsWithMcp));
    expect(output).toContain('MCP tools (1)');
  });

  it('should handle no active session (zero messages)', () => {
    const noSessionInfo = {
      ...baseInfo,
      sessionId: null,
      messageTokens: 0,
      messageCount: 0,
    };
    const output = stripAnsi(renderContextDisplay(noSessionInfo, mockTools));
    expect(output).toContain('Messages (0)');
  });

  it('should contain progress bar block characters', () => {
    const output = renderContextDisplay(baseInfo, mockTools);
    const plain = stripAnsi(output);
    expect(plain).toContain('[');
    expect(plain).toContain(']');
  });
});
