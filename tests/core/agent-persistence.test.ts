/**
 * AgentPersistence Tests
 * Tests success counting, threshold logic, persistence to disk, and loading.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentPersistence } from '../../src/core/agent-persistence';
import type { AgentDefinition } from '../../src/core/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(tmpdir(), `daemux-test-agents-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeDynamicAgent(overrides?: Partial<AgentDefinition>): AgentDefinition {
  return {
    name: 'code-reviewer',
    description: 'Reviews code for quality',
    model: 'haiku',
    tools: ['Read', 'Grep', 'Glob'],
    color: 'cyan',
    systemPrompt: 'You are a code reviewer. Check for bugs and security issues.',
    pluginId: 'dynamic',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentPersistence', () => {
  let tempDir: string;
  let persistence: AgentPersistence;

  beforeEach(() => {
    tempDir = makeTempDir();
    persistence = new AgentPersistence({ threshold: 3, agentsDir: tempDir });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // recordSuccess
  // -------------------------------------------------------------------------

  describe('recordSuccess', () => {
    it('should increment success count', () => {
      const agent = makeDynamicAgent();

      persistence.recordSuccess(agent);
      expect(persistence.getSuccessCount('code-reviewer')).toBe(1);

      persistence.recordSuccess(agent);
      expect(persistence.getSuccessCount('code-reviewer')).toBe(2);
    });

    it('should ignore non-dynamic agents', () => {
      const coreAgent = makeDynamicAgent({ pluginId: 'core' });

      persistence.recordSuccess(coreAgent);

      expect(persistence.getSuccessCount('code-reviewer')).toBe(0);
    });

    it('should track counts per agent independently', () => {
      const agentA = makeDynamicAgent({ name: 'agent-aaa' });
      const agentB = makeDynamicAgent({ name: 'agent-bbb' });

      persistence.recordSuccess(agentA);
      persistence.recordSuccess(agentA);
      persistence.recordSuccess(agentB);

      expect(persistence.getSuccessCount('agent-aaa')).toBe(2);
      expect(persistence.getSuccessCount('agent-bbb')).toBe(1);
    });

    it('should auto-persist after reaching threshold', async () => {
      const agent = makeDynamicAgent();

      persistence.recordSuccess(agent);
      persistence.recordSuccess(agent);
      persistence.recordSuccess(agent);

      // Wait for async persist
      await new Promise(r => setTimeout(r, 50));

      const filePath = join(tempDir, 'code-reviewer.md');
      expect(existsSync(filePath)).toBe(true);
    });

    it('should not persist before reaching threshold', async () => {
      const agent = makeDynamicAgent();

      persistence.recordSuccess(agent);
      persistence.recordSuccess(agent);

      await new Promise(r => setTimeout(r, 50));

      const filePath = join(tempDir, 'code-reviewer.md');
      expect(existsSync(filePath)).toBe(false);
    });

    it('should only persist once at threshold, not on subsequent successes', async () => {
      const agent = makeDynamicAgent();

      for (let i = 0; i < 6; i++) {
        persistence.recordSuccess(agent);
      }

      await new Promise(r => setTimeout(r, 50));

      // File should exist (persisted at count 3), and subsequent calls
      // should not cause issues
      const filePath = join(tempDir, 'code-reviewer.md');
      expect(existsSync(filePath)).toBe(true);
      expect(persistence.getSuccessCount('code-reviewer')).toBe(6);
    });
  });

  // -------------------------------------------------------------------------
  // shouldPersist
  // -------------------------------------------------------------------------

  describe('shouldPersist', () => {
    it('should return false before threshold', () => {
      const agent = makeDynamicAgent();

      persistence.recordSuccess(agent);
      expect(persistence.shouldPersist('code-reviewer')).toBe(false);
    });

    it('should return true at threshold', () => {
      const agent = makeDynamicAgent();

      persistence.recordSuccess(agent);
      persistence.recordSuccess(agent);
      persistence.recordSuccess(agent);

      expect(persistence.shouldPersist('code-reviewer')).toBe(true);
    });

    it('should return true above threshold', () => {
      const agent = makeDynamicAgent();

      for (let i = 0; i < 5; i++) {
        persistence.recordSuccess(agent);
      }

      expect(persistence.shouldPersist('code-reviewer')).toBe(true);
    });

    it('should return false for unknown agent', () => {
      expect(persistence.shouldPersist('nonexistent')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // persist (writing to disk)
  // -------------------------------------------------------------------------

  describe('persist', () => {
    it('should write agent markdown to disk', async () => {
      const agent = makeDynamicAgent();

      await persistence.persist(agent);

      const filePath = join(tempDir, 'code-reviewer.md');
      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('name: code-reviewer');
      expect(content).toContain('description: Reviews code for quality');
      expect(content).toContain('model: haiku');
      expect(content).toContain('color: cyan');
      expect(content).toContain('  - Read');
      expect(content).toContain('  - Grep');
      expect(content).toContain('  - Glob');
      expect(content).toContain('You are a code reviewer');
    });

    it('should write valid frontmatter format', async () => {
      const agent = makeDynamicAgent();

      await persistence.persist(agent);

      const filePath = join(tempDir, 'code-reviewer.md');
      const content = readFileSync(filePath, 'utf-8');

      // Should start and end with ---
      expect(content.startsWith('---\n')).toBe(true);
      expect(content).toContain('\n---\n');
    });

    it('should create agents directory if it does not exist', async () => {
      const nestedDir = join(tempDir, 'nested', 'agents');
      const p = new AgentPersistence({ agentsDir: nestedDir });

      await p.persist(makeDynamicAgent());

      expect(existsSync(nestedDir)).toBe(true);
    });

    it('should handle agent with empty tools', async () => {
      const agent = makeDynamicAgent({ tools: [] });

      await persistence.persist(agent);

      const filePath = join(tempDir, 'code-reviewer.md');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toContain('tools: []');
    });
  });

  // -------------------------------------------------------------------------
  // loadPersistedAgents
  // -------------------------------------------------------------------------

  describe('loadPersistedAgents', () => {
    it('should load agents from markdown files', async () => {
      // Write a valid agent file
      const agentContent = [
        '---',
        'name: persisted-agent',
        'description: A persisted agent',
        'model: inherit',
        'tools:',
        '  - Read',
        '  - Write',
        'color: green',
        '---',
        '',
        'You are a persisted agent.',
        '',
      ].join('\n');

      writeFileSync(join(tempDir, 'persisted-agent.md'), agentContent, 'utf-8');

      const agents = await persistence.loadPersistedAgents();

      expect(agents.length).toBe(1);
      expect(agents[0].name).toBe('persisted-agent');
      expect(agents[0].description).toBe('A persisted agent');
      expect(agents[0].model).toBe('inherit');
      expect(agents[0].tools).toEqual(['Read', 'Write']);
      expect(agents[0].color).toBe('green');
      expect(agents[0].systemPrompt).toBe('You are a persisted agent.');
      expect(agents[0].pluginId).toBe('persisted');
    });

    it('should return empty array if directory does not exist', async () => {
      const p = new AgentPersistence({ agentsDir: '/tmp/nonexistent-daemux-dir-xyz' });

      const agents = await p.loadPersistedAgents();

      expect(agents).toEqual([]);
    });

    it('should skip non-markdown files', async () => {
      writeFileSync(join(tempDir, 'config.json'), '{}', 'utf-8');

      const agents = await persistence.loadPersistedAgents();

      expect(agents).toEqual([]);
    });

    it('should skip files without required frontmatter fields', async () => {
      const incomplete = '---\nname: test\n---\nNo description field.\n';
      writeFileSync(join(tempDir, 'bad-agent.md'), incomplete, 'utf-8');

      const agents = await persistence.loadPersistedAgents();

      expect(agents).toEqual([]);
    });

    it('should load multiple agents', async () => {
      for (const name of ['alpha', 'bravo', 'charlie']) {
        const content = [
          '---',
          `name: ${name}`,
          `description: Agent ${name}`,
          'model: inherit',
          'tools: []',
          'color: blue',
          '---',
          '',
          `You are ${name}.`,
          '',
        ].join('\n');
        writeFileSync(join(tempDir, `${name}.md`), content, 'utf-8');
      }

      const agents = await persistence.loadPersistedAgents();
      expect(agents.length).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // Round-trip (persist then load)
  // -------------------------------------------------------------------------

  describe('round-trip', () => {
    it('should persist and reload an agent with matching format', async () => {
      const original = makeDynamicAgent();

      await persistence.persist(original);
      const loaded = await persistence.loadPersistedAgents();

      expect(loaded.length).toBe(1);
      expect(loaded[0].name).toBe(original.name);
      expect(loaded[0].description).toBe(original.description);
      expect(loaded[0].model).toBe(original.model);
      expect(loaded[0].tools).toEqual(original.tools);
      expect(loaded[0].color).toBe(original.color);
      expect(loaded[0].systemPrompt).toBe(original.systemPrompt);
      expect(loaded[0].pluginId).toBe('persisted');
    });
  });

  // -------------------------------------------------------------------------
  // Custom threshold
  // -------------------------------------------------------------------------

  describe('custom threshold', () => {
    it('should respect custom threshold value', async () => {
      const p = new AgentPersistence({ threshold: 1, agentsDir: tempDir });
      const agent = makeDynamicAgent();

      p.recordSuccess(agent);

      await new Promise(r => setTimeout(r, 50));

      const filePath = join(tempDir, 'code-reviewer.md');
      expect(existsSync(filePath)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Name validation (path traversal prevention)
  // -------------------------------------------------------------------------

  describe('name validation', () => {
    it('should reject names with path traversal sequences', async () => {
      const agent = makeDynamicAgent({ name: '../etc/passwd' });
      await expect(persistence.persist(agent)).rejects.toThrow('Invalid agent name for persistence');
    });

    it('should reject names with slashes', async () => {
      const agent = makeDynamicAgent({ name: 'foo/bar' });
      await expect(persistence.persist(agent)).rejects.toThrow('Invalid agent name for persistence');
    });

    it('should reject names with backslashes', async () => {
      const agent = makeDynamicAgent({ name: 'foo\\bar' });
      await expect(persistence.persist(agent)).rejects.toThrow('Invalid agent name for persistence');
    });

    it('should reject names starting with a dot', async () => {
      const agent = makeDynamicAgent({ name: '.hidden' });
      await expect(persistence.persist(agent)).rejects.toThrow('Invalid agent name for persistence');
    });

    it('should reject names starting with a hyphen', async () => {
      const agent = makeDynamicAgent({ name: '-dashed' });
      await expect(persistence.persist(agent)).rejects.toThrow('Invalid agent name for persistence');
    });

    it('should reject names with uppercase letters', async () => {
      const agent = makeDynamicAgent({ name: 'MyAgent' });
      await expect(persistence.persist(agent)).rejects.toThrow('Invalid agent name for persistence');
    });

    it('should reject names shorter than 3 characters', async () => {
      const agent = makeDynamicAgent({ name: 'ab' });
      await expect(persistence.persist(agent)).rejects.toThrow('Invalid agent name for persistence');
    });

    it('should reject names longer than 50 characters', async () => {
      const agent = makeDynamicAgent({ name: 'a' + 'b'.repeat(50) });
      await expect(persistence.persist(agent)).rejects.toThrow('Invalid agent name for persistence');
    });

    it('should reject names with spaces', async () => {
      const agent = makeDynamicAgent({ name: 'my agent' });
      await expect(persistence.persist(agent)).rejects.toThrow('Invalid agent name for persistence');
    });

    it('should reject empty name', async () => {
      const agent = makeDynamicAgent({ name: '' });
      await expect(persistence.persist(agent)).rejects.toThrow('Invalid agent name for persistence');
    });

    it('should accept valid lowercase names with hyphens', async () => {
      const agent = makeDynamicAgent({ name: 'code-reviewer' });
      await persistence.persist(agent);
      expect(existsSync(join(tempDir, 'code-reviewer.md'))).toBe(true);
    });

    it('should accept valid names with digits', async () => {
      const agent = makeDynamicAgent({ name: 'agent-v2' });
      await persistence.persist(agent);
      expect(existsSync(join(tempDir, 'agent-v2.md'))).toBe(true);
    });

    it('should accept minimum valid name (3 chars)', async () => {
      const agent = makeDynamicAgent({ name: 'abc' });
      await persistence.persist(agent);
      expect(existsSync(join(tempDir, 'abc.md'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // File permissions
  // -------------------------------------------------------------------------

  describe('file permissions', () => {
    it('should set 0o600 permissions on persisted agent files', async () => {
      const agent = makeDynamicAgent();

      await persistence.persist(agent);

      const filePath = join(tempDir, 'code-reviewer.md');
      const stat = statSync(filePath);
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });
});
