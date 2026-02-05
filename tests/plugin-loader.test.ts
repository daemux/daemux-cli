/**
 * Plugin Loader Unit Tests
 * Tests plugin discovery and loading
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { PluginLoader, createPluginLoader } from '../src/core/plugin-loader';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';

describe('PluginLoader', () => {
  const testDir = join(import.meta.dir, 'test-plugins');
  const testPluginDir = join(testDir, 'test-plugin');
  const testPluginClaudeDir = join(testPluginDir, '.claude-plugin');
  const testPluginAgentsDir = join(testPluginDir, 'agents');

  beforeEach(() => {
    // Clean up and create test directories
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(testPluginClaudeDir, { recursive: true });
    mkdirSync(testPluginAgentsDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('Plugin Discovery', () => {
    it('should discover plugins in configured paths', async () => {
      // Create a valid plugin manifest
      writeFileSync(
        join(testPluginClaudeDir, 'plugin.json'),
        JSON.stringify({
          name: 'test-plugin',
          version: '1.0.0',
          description: 'A test plugin',
        })
      );

      const loader = new PluginLoader({ pluginPaths: [testDir] });
      const plugins = await loader.discoverAll();

      expect(plugins.length).toBe(1);
      expect(plugins[0].manifest.name).toBe('test-plugin');
    });

    it('should skip directories without plugin.json', async () => {
      // Create a directory without plugin.json
      mkdirSync(join(testDir, 'not-a-plugin'), { recursive: true });

      const loader = new PluginLoader({ pluginPaths: [testDir] });
      const plugins = await loader.discoverAll();

      expect(plugins.length).toBe(0);
    });

    it('should skip non-directory entries', async () => {
      // Create a file in the plugins directory
      writeFileSync(join(testDir, 'some-file.txt'), 'not a plugin');

      // Create valid plugin
      writeFileSync(
        join(testPluginClaudeDir, 'plugin.json'),
        JSON.stringify({
          name: 'test-plugin',
          version: '1.0.0',
        })
      );

      const loader = new PluginLoader({ pluginPaths: [testDir] });
      const plugins = await loader.discoverAll();

      expect(plugins.length).toBe(1);
    });

    it('should handle non-existent plugin paths', async () => {
      const loader = new PluginLoader({
        pluginPaths: ['/non/existent/path', testDir],
      });

      // Should not throw
      const plugins = await loader.discoverAll();
      expect(Array.isArray(plugins)).toBe(true);
    });
  });

  describe('Plugin Loading', () => {
    it('should load plugin manifest', async () => {
      writeFileSync(
        join(testPluginClaudeDir, 'plugin.json'),
        JSON.stringify({
          name: 'my-plugin',
          version: '2.0.0',
          description: 'My test plugin',
          author: 'Test Author',
          homepage: 'https://example.com',
        })
      );

      const loader = new PluginLoader({ pluginPaths: [testDir] });
      const plugin = await loader.loadPlugin(testPluginDir);

      expect(plugin).not.toBeNull();
      expect(plugin?.manifest.name).toBe('my-plugin');
      expect(plugin?.manifest.version).toBe('2.0.0');
      expect(plugin?.manifest.author).toBe('Test Author');
    });

    it('should return null for invalid manifest', async () => {
      writeFileSync(
        join(testPluginClaudeDir, 'plugin.json'),
        JSON.stringify({
          // Missing required 'name' and 'version'
          description: 'Invalid plugin',
        })
      );

      const loader = new PluginLoader({ pluginPaths: [testDir] });
      const plugin = await loader.loadPlugin(testPluginDir);

      expect(plugin).toBeNull();
    });

    it('should return null for malformed JSON', async () => {
      writeFileSync(
        join(testPluginClaudeDir, 'plugin.json'),
        'not valid json {'
      );

      const loader = new PluginLoader({ pluginPaths: [testDir] });

      // Should not throw, just return null
      await expect(loader.loadPlugin(testPluginDir)).rejects.toThrow();
    });

    it('should store loaded plugins', async () => {
      writeFileSync(
        join(testPluginClaudeDir, 'plugin.json'),
        JSON.stringify({
          name: 'stored-plugin',
          version: '1.0.0',
        })
      );

      const loader = new PluginLoader({ pluginPaths: [testDir] });
      await loader.loadPlugin(testPluginDir);

      const plugins = loader.getPlugins();
      expect(plugins.length).toBe(1);

      const plugin = loader.getPlugin('stored-plugin');
      expect(plugin).not.toBeUndefined();
      expect(plugin?.manifest.name).toBe('stored-plugin');
    });
  });

  describe('Agent Loading', () => {
    beforeEach(() => {
      writeFileSync(
        join(testPluginClaudeDir, 'plugin.json'),
        JSON.stringify({
          name: 'agent-plugin',
          version: '1.0.0',
        })
      );
    });

    it('should load agents from markdown files', async () => {
      writeFileSync(
        join(testPluginAgentsDir, 'test-agent.md'),
        `---
name: test-agent
description: A test agent
model: inherit
color: blue
---

You are a test agent. Be helpful.
`
      );

      const loader = new PluginLoader({ pluginPaths: [testDir] });
      const plugin = await loader.loadPlugin(testPluginDir);

      expect(plugin?.agents.length).toBe(1);
      expect(plugin?.agents[0].name).toBe('test-agent');
      expect(plugin?.agents[0].description).toBe('A test agent');
      expect(plugin?.agents[0].color).toBe('blue');
      expect(plugin?.agents[0].systemPrompt).toContain('You are a test agent');
    });

    it('should handle agents with tools', async () => {
      writeFileSync(
        join(testPluginAgentsDir, 'tool-agent.md'),
        `---
name: tool-agent
description: Agent with tools
model: sonnet
tools: ["bash", "read_file"]
color: green
---

You have access to tools.
`
      );

      const loader = new PluginLoader({ pluginPaths: [testDir] });
      const plugin = await loader.loadPlugin(testPluginDir);

      expect(plugin?.agents[0].tools).toEqual(['bash', 'read_file']);
    });

    it('should skip agents without frontmatter', async () => {
      writeFileSync(
        join(testPluginAgentsDir, 'no-frontmatter.md'),
        `This is just regular markdown without frontmatter.`
      );

      const loader = new PluginLoader({ pluginPaths: [testDir] });
      const plugin = await loader.loadPlugin(testPluginDir);

      expect(plugin?.agents.length).toBe(0);
    });

    it('should skip agents with invalid frontmatter', async () => {
      writeFileSync(
        join(testPluginAgentsDir, 'invalid-agent.md'),
        `---
name: ab
description: Name too short
color: invalid-color
---

Content here.
`
      );

      const loader = new PluginLoader({ pluginPaths: [testDir] });
      const plugin = await loader.loadPlugin(testPluginDir);

      expect(plugin?.agents.length).toBe(0);
    });

    it('should load multiple agents', async () => {
      writeFileSync(
        join(testPluginAgentsDir, 'agent-one.md'),
        `---
name: agent-one
description: First agent
color: blue
---

First agent prompt.
`
      );

      writeFileSync(
        join(testPluginAgentsDir, 'agent-two.md'),
        `---
name: agent-two
description: Second agent
color: green
---

Second agent prompt.
`
      );

      const loader = new PluginLoader({ pluginPaths: [testDir] });
      const plugin = await loader.loadPlugin(testPluginDir);

      expect(plugin?.agents.length).toBe(2);
    });

    it('should get all agents from all plugins', async () => {
      writeFileSync(
        join(testPluginAgentsDir, 'my-agent.md'),
        `---
name: my-agent
description: Test agent
color: blue
---

Agent prompt.
`
      );

      const loader = new PluginLoader({ pluginPaths: [testDir] });
      await loader.discoverAll();

      const allAgents = loader.getAllAgents();
      expect(allAgents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('MCP Config Loading', () => {
    beforeEach(() => {
      writeFileSync(
        join(testPluginClaudeDir, 'plugin.json'),
        JSON.stringify({
          name: 'mcp-plugin',
          version: '1.0.0',
        })
      );
    });

    it('should load MCP config from .mcp.json', async () => {
      writeFileSync(
        join(testPluginDir, '.mcp.json'),
        JSON.stringify({
          servers: {
            'my-server': {
              command: 'node',
              args: ['server.js'],
              env: { PORT: '3000' },
            },
          },
        })
      );

      const loader = new PluginLoader({ pluginPaths: [testDir] });
      const plugin = await loader.loadPlugin(testPluginDir);

      expect(plugin?.mcpConfig).toBeDefined();
      expect(plugin?.mcpConfig?.['my-server']).toBeDefined();
      expect(plugin?.mcpConfig?.['my-server'].command).toBe('node');
    });

    it('should handle direct MCP config format', async () => {
      writeFileSync(
        join(testPluginDir, '.mcp.json'),
        JSON.stringify({
          'direct-server': {
            command: 'python',
            args: ['server.py'],
          },
        })
      );

      const loader = new PluginLoader({ pluginPaths: [testDir] });
      const plugin = await loader.loadPlugin(testPluginDir);

      expect(plugin?.mcpConfig?.['direct-server']).toBeDefined();
    });

    it('should handle missing MCP config', async () => {
      const loader = new PluginLoader({ pluginPaths: [testDir] });
      const plugin = await loader.loadPlugin(testPluginDir);

      expect(plugin?.mcpConfig).toBeUndefined();
    });
  });

  describe('Custom Agents Directory', () => {
    it('should use custom agents directory from manifest', async () => {
      const customAgentsDir = join(testPluginDir, 'custom-agents');
      mkdirSync(customAgentsDir, { recursive: true });

      writeFileSync(
        join(testPluginClaudeDir, 'plugin.json'),
        JSON.stringify({
          name: 'custom-dir-plugin',
          version: '1.0.0',
          agents: 'custom-agents',
        })
      );

      writeFileSync(
        join(customAgentsDir, 'custom-agent.md'),
        `---
name: custom-agent
description: Agent in custom directory
color: yellow
---

Custom agent prompt.
`
      );

      const loader = new PluginLoader({ pluginPaths: [testDir] });
      const plugin = await loader.loadPlugin(testPluginDir);

      expect(plugin?.agents.length).toBe(1);
      expect(plugin?.agents[0].name).toBe('custom-agent');
    });
  });

  describe('Plugin API', () => {
    it('should throw error when activating without API', async () => {
      writeFileSync(
        join(testPluginClaudeDir, 'plugin.json'),
        JSON.stringify({
          name: 'api-test-plugin',
          version: '1.0.0',
        })
      );

      const loader = new PluginLoader({ pluginPaths: [testDir] });
      const plugin = await loader.loadPlugin(testPluginDir);

      await expect(loader.activateAll()).rejects.toThrow('Plugin API not set');
    });

    it('should set and use plugin API', async () => {
      writeFileSync(
        join(testPluginClaudeDir, 'plugin.json'),
        JSON.stringify({
          name: 'with-api-plugin',
          version: '1.0.0',
        })
      );

      writeFileSync(
        join(testPluginAgentsDir, 'api-agent.md'),
        `---
name: api-agent
description: Agent for API test
color: red
---

API agent prompt.
`
      );

      const loader = new PluginLoader({ pluginPaths: [testDir] });
      await loader.loadPlugin(testPluginDir);

      const registeredAgents: any[] = [];
      const registeredMCP: any[] = [];

      loader.setAPI({
        registerAgent: (agent) => registeredAgents.push(agent),
        registerMCP: (id, config) => registeredMCP.push({ id, config }),
        registerHook: () => {},
        registerCommand: () => {},
        getConfig: () => ({} as any),
        getLogger: () => ({} as any),
        getEventBus: () => ({} as any),
      });

      await loader.activateAll();

      expect(registeredAgents.length).toBe(1);
      expect(registeredAgents[0].name).toBe('api-agent');
    });
  });

  describe('Factory Function', () => {
    it('should create loader with factory', () => {
      const loader = createPluginLoader({ pluginPaths: [testDir] });
      expect(loader).toBeInstanceOf(PluginLoader);
    });
  });
});
