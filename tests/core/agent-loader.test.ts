/**
 * Agent Loader Tests
 * Tests loading built-in agents from src/agents/ markdown files.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadBuiltinAgents, parseFrontmatter } from '../../src/core/agent-loader';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EXPLORE_MD = `---
name: explore
description: Fast read-only code exploration agent
model: haiku
tools:
  - Read
  - Glob
  - Grep
  - Bash
color: cyan
---

You are an exploration agent.
`.trim();

const PLAN_MD = `---
name: plan
description: Architecture design agent for planning implementations
model: inherit
tools:
  - Read
  - Glob
  - Grep
color: green
---

You are a planning agent.
`.trim();

const GENERAL_MD = `---
name: general
description: Full-capability agent for multi-step tasks
model: inherit
tools: []
color: blue
---

You are a general-purpose agent.
`.trim();

const RESEARCHER_MD = `---
name: researcher
description: Web and code research agent
model: haiku
tools:
  - Read
  - Glob
  - Grep
  - WebFetch
  - WebSearch
color: yellow
---

You are a research agent.
`.trim();

// ---------------------------------------------------------------------------
// parseFrontmatter Unit Tests
// ---------------------------------------------------------------------------

describe('parseFrontmatter', () => {
  it('should parse basic key-value pairs', () => {
    const content = `---
name: explore
description: Fast exploration agent
model: haiku
---

Body content here.`;

    const { data, body } = parseFrontmatter(content);
    expect(data.name).toBe('explore');
    expect(data.description).toBe('Fast exploration agent');
    expect(data.model).toBe('haiku');
    expect(body.trim()).toBe('Body content here.');
  });

  it('should parse YAML list syntax (- item)', () => {
    const content = `---
name: test-agent
tools:
  - Read
  - Write
  - Bash
---

Prompt.`;

    const { data } = parseFrontmatter(content);
    expect(data.tools).toEqual(['Read', 'Write', 'Bash']);
  });

  it('should parse inline JSON array', () => {
    const content = `---
name: test-agent
tools: ["Read", "Write"]
---

Prompt.`;

    const { data } = parseFrontmatter(content);
    expect(data.tools).toEqual(['Read', 'Write']);
  });

  it('should parse empty inline array as empty tools', () => {
    const content = `---
name: general
tools: []
---

Prompt.`;

    const { data } = parseFrontmatter(content);
    expect(data.tools).toEqual([]);
  });

  it('should parse boolean values', () => {
    const content = `---
name: test-agent
enabled: true
disabled: false
---

Prompt.`;

    const { data } = parseFrontmatter(content);
    expect(data.enabled).toBe(true);
    expect(data.disabled).toBe(false);
  });

  it('should strip surrounding quotes from values', () => {
    const content = `---
name: "test-agent"
description: 'A test agent'
---

Prompt.`;

    const { data } = parseFrontmatter(content);
    expect(data.name).toBe('test-agent');
    expect(data.description).toBe('A test agent');
  });

  it('should return empty data for content without frontmatter', () => {
    const content = 'No frontmatter here, just text.';
    const { data, body } = parseFrontmatter(content);
    expect(data).toEqual({});
    expect(body).toBe(content);
  });

  it('should skip comment lines in frontmatter', () => {
    const content = `---
name: test-agent
# This is a comment
description: A test agent
---

Prompt.`;

    const { data } = parseFrontmatter(content);
    expect(data.name).toBe('test-agent');
    expect(data.description).toBe('A test agent');
  });

  it('should handle multiple YAML lists', () => {
    const content = `---
name: test-agent
tools:
  - Read
  - Write
tags:
  - alpha
  - beta
---

Prompt.`;

    const { data } = parseFrontmatter(content);
    expect(data.tools).toEqual(['Read', 'Write']);
    expect(data.tags).toEqual(['alpha', 'beta']);
  });

  it('should handle YAML list followed by scalar', () => {
    const content = `---
tools:
  - Read
  - Write
name: test-agent
---

Prompt.`;

    const { data } = parseFrontmatter(content);
    expect(data.tools).toEqual(['Read', 'Write']);
    expect(data.name).toBe('test-agent');
  });
});

// ---------------------------------------------------------------------------
// loadBuiltinAgents Tests
// ---------------------------------------------------------------------------

describe('loadBuiltinAgents', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `agent-loader-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should load all 4 built-in agents from src/agents/', () => {
    const agents = loadBuiltinAgents(join(process.cwd(), 'src', 'agents'));
    expect(agents.length).toBe(4);

    const names = agents.map(a => a.name).sort();
    expect(names).toEqual(['explore', 'general', 'plan', 'researcher']);
  });

  it('should parse frontmatter correctly for each agent', () => {
    const agents = loadBuiltinAgents(join(process.cwd(), 'src', 'agents'));

    const explore = agents.find(a => a.name === 'explore');
    expect(explore).toBeDefined();
    expect(explore!.description).toBe('Fast read-only code exploration agent');
    expect(explore!.model).toBe('haiku');
    expect(explore!.tools).toEqual(['Read', 'Glob', 'Grep', 'Bash']);
    expect(explore!.color).toBe('cyan');

    const plan = agents.find(a => a.name === 'plan');
    expect(plan).toBeDefined();
    expect(plan!.model).toBe('inherit');
    expect(plan!.tools).toEqual(['Read', 'Glob', 'Grep']);
    expect(plan!.color).toBe('green');

    const researcher = agents.find(a => a.name === 'researcher');
    expect(researcher).toBeDefined();
    expect(researcher!.model).toBe('haiku');
    expect(researcher!.tools).toEqual(['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch']);
    expect(researcher!.color).toBe('yellow');
  });

  it('should extract system prompt from markdown body', () => {
    const agents = loadBuiltinAgents(join(process.cwd(), 'src', 'agents'));

    const explore = agents.find(a => a.name === 'explore');
    expect(explore!.systemPrompt).toContain('exploration agent');
    expect(explore!.systemPrompt).not.toContain('---');

    const general = agents.find(a => a.name === 'general');
    expect(general!.systemPrompt).toContain('general-purpose agent');
  });

  it('should set pluginId to core for all agents', () => {
    const agents = loadBuiltinAgents(join(process.cwd(), 'src', 'agents'));
    for (const agent of agents) {
      expect(agent.pluginId).toBe('core');
    }
  });

  it('should handle empty tools array (general agent)', () => {
    const agents = loadBuiltinAgents(join(process.cwd(), 'src', 'agents'));
    const general = agents.find(a => a.name === 'general');
    expect(general).toBeDefined();
    expect(general!.tools).toEqual([]);
  });

  it('should handle custom agents directory', () => {
    writeFileSync(join(tempDir, 'custom.md'), EXPLORE_MD);
    const agents = loadBuiltinAgents(tempDir);
    expect(agents.length).toBe(1);
    expect(agents[0].name).toBe('explore');
  });

  it('should load multiple agents from custom directory', () => {
    writeFileSync(join(tempDir, 'explore.md'), EXPLORE_MD);
    writeFileSync(join(tempDir, 'plan.md'), PLAN_MD);
    writeFileSync(join(tempDir, 'general.md'), GENERAL_MD);
    writeFileSync(join(tempDir, 'researcher.md'), RESEARCHER_MD);

    const agents = loadBuiltinAgents(tempDir);
    expect(agents.length).toBe(4);
  });

  it('should ignore non-.md files', () => {
    writeFileSync(join(tempDir, 'explore.md'), EXPLORE_MD);
    writeFileSync(join(tempDir, 'notes.txt'), 'Just notes');
    writeFileSync(join(tempDir, 'config.json'), '{}');
    writeFileSync(join(tempDir, 'README'), 'Readme content');

    const agents = loadBuiltinAgents(tempDir);
    expect(agents.length).toBe(1);
    expect(agents[0].name).toBe('explore');
  });

  it('should return empty array for nonexistent directory', () => {
    const agents = loadBuiltinAgents('/nonexistent/path/that/does/not/exist');
    expect(agents).toEqual([]);
  });

  it('should skip .md files without required frontmatter fields', () => {
    writeFileSync(join(tempDir, 'valid.md'), EXPLORE_MD);
    writeFileSync(join(tempDir, 'no-name.md'), `---
description: Missing name field
---

Some prompt.`);
    writeFileSync(join(tempDir, 'no-desc.md'), `---
name: incomplete
---

Some prompt.`);
    writeFileSync(join(tempDir, 'no-frontmatter.md'), 'Just plain markdown without frontmatter.');

    const agents = loadBuiltinAgents(tempDir);
    expect(agents.length).toBe(1);
    expect(agents[0].name).toBe('explore');
  });

  it('should default model to inherit when not specified', () => {
    writeFileSync(join(tempDir, 'no-model.md'), `---
name: test-agent
description: Agent without model field
color: red
---

A prompt.`);

    const agents = loadBuiltinAgents(tempDir);
    expect(agents.length).toBe(1);
    expect(agents[0].model).toBe('inherit');
  });

  it('should default color to blue when not specified', () => {
    writeFileSync(join(tempDir, 'no-color.md'), `---
name: test-agent
description: Agent without color field
---

A prompt.`);

    const agents = loadBuiltinAgents(tempDir);
    expect(agents.length).toBe(1);
    expect(agents[0].color).toBe('blue');
  });

  it('should default tools to empty array when not specified', () => {
    writeFileSync(join(tempDir, 'no-tools.md'), `---
name: test-agent
description: Agent without tools field
color: red
---

A prompt.`);

    const agents = loadBuiltinAgents(tempDir);
    expect(agents.length).toBe(1);
    expect(agents[0].tools).toEqual([]);
  });

  it('should return empty array for directory with no .md files', () => {
    // tempDir exists but contains no .md files
    writeFileSync(join(tempDir, 'notes.txt'), 'Just a text file');
    writeFileSync(join(tempDir, 'config.json'), '{}');

    const agents = loadBuiltinAgents(tempDir);
    expect(agents).toEqual([]);
  });

  it('should skip files larger than 64KB', () => {
    writeFileSync(join(tempDir, 'valid.md'), EXPLORE_MD);
    // Create a file larger than 64KB (65537 bytes)
    const largeContent = '---\nname: big\ndescription: Too large\n---\n' + 'x'.repeat(65537);
    writeFileSync(join(tempDir, 'large.md'), largeContent);

    const agents = loadBuiltinAgents(tempDir);
    expect(agents.length).toBe(1);
    expect(agents[0].name).toBe('explore');
  });
});

// ---------------------------------------------------------------------------
// parseFrontmatter CRLF + colon-in-value Tests
// ---------------------------------------------------------------------------

describe('parseFrontmatter edge cases', () => {
  it('should handle CRLF line endings in frontmatter', () => {
    const content = '---\r\nname: test-agent\r\ndescription: A CRLF agent\r\nmodel: haiku\r\n---\r\n\r\nBody with CRLF.';

    const { data, body } = parseFrontmatter(content);
    expect(data.name).toBe('test-agent');
    expect(data.description).toBe('A CRLF agent');
    expect(data.model).toBe('haiku');
    expect(body.trim()).toBe('Body with CRLF.');
  });

  it('should preserve colons in frontmatter values', () => {
    const content = `---
name: my-agent
description: URL is http://localhost:3000
endpoint: https://api.example.com:8080/v1
---

Prompt.`;

    const { data } = parseFrontmatter(content);
    expect(data.name).toBe('my-agent');
    expect(data.description).toBe('URL is http://localhost:3000');
    expect(data.endpoint).toBe('https://api.example.com:8080/v1');
  });
});
