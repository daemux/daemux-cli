/**
 * Plugin Discovery and Loading System
 * Discovers plugins from ~/.daemux/plugins/ and ./.daemux/plugins/
 */

import { join, basename, dirname } from 'path';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { z } from 'zod';
import type { AgentDefinition } from './types';
import type { Plugin, PluginManifest, PluginAPI, MCPConfig } from './plugin-api-types';

// ---------------------------------------------------------------------------
// Plugin Manifest Schema
// ---------------------------------------------------------------------------

const PluginManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string(),
  description: z.string().optional(),
  author: z.string().optional(),
  homepage: z.string().optional(),
  main: z.string().optional(),
  agents: z.string().or(z.array(z.string())).optional(),
  commands: z.string().optional(),
  hooks: z.string().optional(),
  mcp: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Agent Frontmatter Schema
// ---------------------------------------------------------------------------

const AgentFrontmatterSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{2,49}$/),
  description: z.string(),
  model: z.enum(['inherit', 'sonnet', 'opus', 'haiku']).default('inherit'),
  tools: z.array(z.string()).optional(),
  color: z.enum(['blue', 'cyan', 'green', 'yellow', 'red']),
});

// ---------------------------------------------------------------------------
// Loaded Plugin Record
// ---------------------------------------------------------------------------

export interface LoadedPlugin {
  manifest: PluginManifest;
  path: string;
  agents: AgentDefinition[];
  mcpConfig?: Record<string, MCPConfig>;
  instance?: Plugin;
}

// ---------------------------------------------------------------------------
// Plugin Loader Class
// ---------------------------------------------------------------------------

export class PluginLoader {
  private pluginPaths: string[];
  private plugins: Map<string, LoadedPlugin> = new Map();
  private api: PluginAPI | null = null;

  constructor(options?: { pluginPaths?: string[]; projectDir?: string }) {
    const projectDir = options?.projectDir ?? process.cwd();
    this.pluginPaths = options?.pluginPaths ?? [
      join(homedir(), '.daemux', 'plugins'),
      join(projectDir, '.daemux', 'plugins'),
    ];
  }

  /**
   * Set the Plugin API for activating plugins
   */
  setAPI(api: PluginAPI): void {
    this.api = api;
  }

  /**
   * Discover and load all plugins from configured paths
   */
  async discoverAll(): Promise<LoadedPlugin[]> {
    const discovered: LoadedPlugin[] = [];

    for (const basePath of this.pluginPaths) {
      if (!existsSync(basePath)) continue;

      const entries = readdirSync(basePath);
      for (const entry of entries) {
        const pluginPath = join(basePath, entry);
        const stat = statSync(pluginPath);
        if (!stat.isDirectory()) continue;

        try {
          const plugin = await this.loadPlugin(pluginPath);
          if (plugin) {
            discovered.push(plugin);
          }
        } catch (err) {
          console.warn(`Failed to load plugin at ${pluginPath}:`, err);
        }
      }
    }

    return discovered;
  }

  /**
   * Load a single plugin from a directory
   */
  async loadPlugin(pluginPath: string): Promise<LoadedPlugin | null> {
    // Check for manifest in .claude-plugin/ directory
    const manifestPath = join(pluginPath, '.claude-plugin', 'plugin.json');
    if (!existsSync(manifestPath)) {
      return null;
    }

    // Parse manifest
    const manifestData = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const result = PluginManifestSchema.safeParse(manifestData);
    if (!result.success) {
      console.warn(`Invalid plugin manifest at ${manifestPath}:`, result.error.issues);
      return null;
    }

    const manifest = result.data as PluginManifest;
    const pluginId = manifest.name;

    // Load agents
    const agents = await this.loadAgents(pluginPath, manifest, pluginId);

    // Load MCP config
    const mcpConfig = await this.loadMCPConfig(pluginPath, manifest);

    const loadedPlugin: LoadedPlugin = {
      manifest,
      path: pluginPath,
      agents,
      mcpConfig,
    };

    // Load and instantiate plugin module if main is specified
    if (manifest.main) {
      const mainPath = join(pluginPath, manifest.main);
      if (existsSync(mainPath)) {
        try {
          const module = await import(mainPath);
          if (module.default) {
            loadedPlugin.instance = module.default as Plugin;
          }
        } catch (err) {
          console.warn(`Failed to load plugin module at ${mainPath}:`, err);
        }
      }
    }

    this.plugins.set(pluginId, loadedPlugin);
    return loadedPlugin;
  }

  /**
   * Activate all loaded plugins
   */
  async activateAll(): Promise<void> {
    if (!this.api) {
      throw new Error('Plugin API not set. Call setAPI() first.');
    }

    for (const plugin of this.plugins.values()) {
      await this.activatePlugin(plugin);
    }
  }

  /**
   * Activate a single plugin
   */
  async activatePlugin(plugin: LoadedPlugin): Promise<void> {
    if (!this.api) {
      throw new Error('Plugin API not set. Call setAPI() first.');
    }

    // Register agents
    for (const agent of plugin.agents) {
      this.api.registerAgent(agent);
    }

    // Register MCP servers
    if (plugin.mcpConfig) {
      for (const [id, config] of Object.entries(plugin.mcpConfig)) {
        this.api.registerMCP(id, config);
      }
    }

    // Call plugin activate hook
    if (plugin.instance?.activate) {
      await plugin.instance.activate(this.api);
    }
  }

  /**
   * Deactivate all plugins
   */
  async deactivateAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.instance?.deactivate) {
        try {
          await plugin.instance.deactivate();
        } catch (err) {
          console.warn(`Failed to deactivate plugin ${plugin.manifest.name}:`, err);
        }
      }
    }
  }

  /**
   * Get all loaded plugins
   */
  getPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get a plugin by name
   */
  getPlugin(name: string): LoadedPlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get all agents from all plugins
   */
  getAllAgents(): AgentDefinition[] {
    const agents: AgentDefinition[] = [];
    for (const plugin of this.plugins.values()) {
      agents.push(...plugin.agents);
    }
    return agents;
  }

  private async loadAgents(
    pluginPath: string,
    manifest: PluginManifest,
    pluginId: string
  ): Promise<AgentDefinition[]> {
    const agents: AgentDefinition[] = [];

    if (Array.isArray(manifest.agents)) {
      // Array of file paths - load each agent file directly
      for (const agentPath of manifest.agents) {
        const fullPath = join(pluginPath, agentPath);
        if (!existsSync(fullPath)) {
          console.warn(`Agent file not found: ${fullPath}`);
          continue;
        }
        try {
          const agent = this.parseAgentFile(fullPath, pluginId);
          if (agent) {
            agents.push(agent);
          }
        } catch (err) {
          console.warn(`Failed to parse agent at ${fullPath}:`, err);
        }
      }
      return agents;
    }

    // String or undefined: load from directory
    const agentsDir = join(pluginPath, manifest.agents ?? 'agents');
    if (existsSync(agentsDir)) {
      agents.push(...await this.loadAgentsFromDirectory(agentsDir, pluginId));
    }

    return agents;
  }

  private async loadAgentsFromDirectory(
    agentsDir: string,
    pluginId: string
  ): Promise<AgentDefinition[]> {
    const agents: AgentDefinition[] = [];
    const entries = readdirSync(agentsDir);

    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;

      const agentPath = join(agentsDir, entry);
      try {
        const agent = this.parseAgentFile(agentPath, pluginId);
        if (agent) {
          agents.push(agent);
        }
      } catch (err) {
        console.warn(`Failed to parse agent at ${agentPath}:`, err);
      }
    }

    return agents;
  }

  private parseAgentFile(filePath: string, pluginId: string): AgentDefinition | null {
    const content = readFileSync(filePath, 'utf-8');
    const { frontmatter, body } = this.parseFrontmatter(content);

    if (!frontmatter) {
      console.warn(`No frontmatter in agent file: ${filePath}`);
      return null;
    }

    const result = AgentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      console.warn(`Invalid agent frontmatter in ${filePath}:`, result.error.issues);
      return null;
    }

    const fm = result.data;
    return {
      name: fm.name,
      description: fm.description,
      model: fm.model,
      tools: fm.tools,
      color: fm.color,
      systemPrompt: body.trim(),
      pluginId,
    };
  }

  private parseFrontmatter(content: string): { frontmatter: Record<string, unknown> | null; body: string } {
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!fmMatch) {
      return { frontmatter: null, body: content };
    }

    const fmContent = fmMatch[1];
    const body = fmMatch[2] ?? '';

    if (!fmContent) {
      return { frontmatter: null, body: content };
    }

    try {
      // Simple YAML parsing (handles basic key: value pairs)
      const frontmatter: Record<string, unknown> = {};
      const lines = fmContent.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const colonIndex = trimmed.indexOf(':');
        if (colonIndex === -1) continue;

        const key = trimmed.slice(0, colonIndex).trim();
        let value: unknown = trimmed.slice(colonIndex + 1).trim();

        // Parse arrays
        if (typeof value === 'string' && value.startsWith('[')) {
          try {
            value = JSON.parse(value);
          } catch {
            // Keep as string if not valid JSON
          }
        }
        // Parse booleans
        else if (value === 'true') value = true;
        else if (value === 'false') value = false;
        // Remove quotes
        else if (typeof value === 'string' && value.match(/^["'].*["']$/)) {
          value = value.slice(1, -1);
        }

        frontmatter[key] = value;
      }

      return { frontmatter, body };
    } catch {
      return { frontmatter: null, body: content };
    }
  }

  private async loadMCPConfig(
    pluginPath: string,
    manifest: PluginManifest
  ): Promise<Record<string, MCPConfig> | undefined> {
    const mcpPath = manifest.mcp
      ? join(pluginPath, manifest.mcp)
      : join(pluginPath, '.mcp.json');

    if (!existsSync(mcpPath)) return undefined;

    try {
      const content = readFileSync(mcpPath, 'utf-8');
      const data = JSON.parse(content);

      // Support both { servers: {...} } and direct {...} formats
      const servers = data.servers ?? data;
      const result: Record<string, MCPConfig> = {};

      for (const [id, config] of Object.entries(servers)) {
        if (typeof config === 'object' && config !== null) {
          result[id] = config as MCPConfig;
        }
      }

      return Object.keys(result).length > 0 ? result : undefined;
    } catch (err) {
      console.warn(`Failed to load MCP config from ${mcpPath}:`, err);
      return undefined;
    }
  }
}

// Global Plugin Loader Instance
let globalLoader: PluginLoader | null = null;

export function createPluginLoader(options?: { pluginPaths?: string[]; projectDir?: string }): PluginLoader {
  globalLoader = new PluginLoader(options);
  return globalLoader;
}

export function getPluginLoader(): PluginLoader {
  if (!globalLoader) globalLoader = new PluginLoader();
  return globalLoader;
}
