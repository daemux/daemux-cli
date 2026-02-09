/**
 * Configuration Management with Priority Resolution
 * Loads from environment, user settings, and project settings
 */

import { z } from 'zod';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { ConfigSchema, type Config } from './types';

// ---------------------------------------------------------------------------
// Settings File Schema (subset of full config)
// ---------------------------------------------------------------------------

const SettingsFileSchema = z.object({
  model: z.string().optional(),
  compactionThreshold: z.number().min(0.5).max(0.95).optional(),
  effectiveContextWindow: z.number().positive().optional(),
  queueMode: z.enum(['steer', 'interrupt', 'queue', 'collect']).optional(),
  collectWindowMs: z.number().positive().optional(),
  hookTimeoutMs: z.number().positive().optional(),
  turnTimeoutMs: z.number().positive().optional(),
  debug: z.boolean().optional(),
  mcpDebug: z.boolean().optional(),
  heartbeatIntervalMs: z.number().positive().optional(),
  heartbeatEnabled: z.boolean().optional(),
  maxConcurrentTasks: z.number().min(1).max(20).optional(),
  workPollingIntervalMs: z.number().positive().optional(),
  workBudgetMaxTasksPerHour: z.number().positive().optional(),
}).passthrough();

export type SettingsFile = z.infer<typeof SettingsFileSchema>;

// ---------------------------------------------------------------------------
// Config Loader Options
// ---------------------------------------------------------------------------

export interface ConfigLoaderOptions {
  projectDir?: string;
  envPrefix?: string;
  skipEnv?: boolean;
  skipUser?: boolean;
  skipProject?: boolean;
}

// ---------------------------------------------------------------------------
// Default Values
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Omit<Config, 'agentId' | 'dataDir'> = {
  model: 'claude-sonnet-4-20250514',
  compactionThreshold: 0.8,
  effectiveContextWindow: 180000,
  queueMode: 'steer',
  collectWindowMs: 5000,
  hookTimeoutMs: 600000,
  turnTimeoutMs: 1800000,
  debug: false,
  mcpDebug: false,
  heartbeatIntervalMs: 1800000,
  heartbeatEnabled: false,
  maxConcurrentTasks: 3,
  workPollingIntervalMs: 5000,
  workBudgetMaxTasksPerHour: 50,
};

// ---------------------------------------------------------------------------
// File Loading Helpers
// ---------------------------------------------------------------------------

function loadJsonFile<T>(path: string, schema: z.ZodSchema<T>): T | null {
  if (!existsSync(path)) return null;

  try {
    const content = readFileSync(path, 'utf-8');
    const data = JSON.parse(content);
    // Clean up deprecated fields from old settings files
    delete data.maxTokens;
    delete data.workMaxIterationsPerTask;
    const result = schema.safeParse(data);
    if (result.success) {
      return result.data;
    }
    console.warn(`Invalid settings in ${path}:`, result.error.issues);
    return null;
  } catch (err) {
    console.warn(`Failed to load settings from ${path}:`, err);
    return null;
  }
}

const getUserSettingsPath = () => join(homedir(), '.daemux', 'settings.json');
const getProjectSettingsPath = (projectDir: string) => join(projectDir, '.daemux', 'settings.json');
const getProjectLocalSettingsPath = (projectDir: string) => join(projectDir, '.daemux', 'settings.local.json');

// ---------------------------------------------------------------------------
// Environment Variable Mapping
// ---------------------------------------------------------------------------

interface EnvMapping {
  envKey: string;
  configKey: keyof Config;
  transform: (value: string) => unknown;
}

const ENV_MAPPINGS: EnvMapping[] = [
  { envKey: 'AGENT_MODEL', configKey: 'model', transform: (v) => v },
  { envKey: 'AGENT_COMPACTION_THRESHOLD', configKey: 'compactionThreshold', transform: (v) => parseFloat(v) },
  { envKey: 'AGENT_CONTEXT_WINDOW', configKey: 'effectiveContextWindow', transform: (v) => parseInt(v, 10) },
  { envKey: 'AGENT_QUEUE_MODE', configKey: 'queueMode', transform: (v) => v },
  { envKey: 'AGENT_COLLECT_WINDOW_MS', configKey: 'collectWindowMs', transform: (v) => parseInt(v, 10) },
  { envKey: 'AGENT_HOOK_TIMEOUT_MS', configKey: 'hookTimeoutMs', transform: (v) => parseInt(v, 10) },
  { envKey: 'AGENT_TURN_TIMEOUT_MS', configKey: 'turnTimeoutMs', transform: (v) => parseInt(v, 10) },
  { envKey: 'AGENT_DEBUG', configKey: 'debug', transform: (v) => v === 'true' || v === '1' },
  { envKey: 'AGENT_MCP_DEBUG', configKey: 'mcpDebug', transform: (v) => v === 'true' || v === '1' },
  { envKey: 'AGENT_HEARTBEAT_INTERVAL_MS', configKey: 'heartbeatIntervalMs', transform: (v) => parseInt(v, 10) },
  { envKey: 'AGENT_HEARTBEAT_ENABLED', configKey: 'heartbeatEnabled', transform: (v) => v === 'true' || v === '1' },
  { envKey: 'AGENT_ID', configKey: 'agentId', transform: (v) => v },
  { envKey: 'AGENT_NAME', configKey: 'agentName', transform: (v) => v },
  { envKey: 'AGENT_DATA_DIR', configKey: 'dataDir', transform: (v) => v },
  { envKey: 'AGENT_MAX_CONCURRENT_TASKS', configKey: 'maxConcurrentTasks', transform: (v: string) => parseInt(v, 10) },
  { envKey: 'AGENT_WORK_POLLING_INTERVAL_MS', configKey: 'workPollingIntervalMs', transform: (v: string) => parseInt(v, 10) },
  { envKey: 'AGENT_WORK_BUDGET_MAX_TASKS_PER_HOUR', configKey: 'workBudgetMaxTasksPerHour', transform: (v: string) => parseInt(v, 10) },
  { envKey: 'ANTHROPIC_LOG', configKey: 'debug', transform: (v: string) => v.toLowerCase() === 'debug' },
];

function loadEnvConfig(prefix?: string): Partial<Config> {
  const config: Partial<Config> = {};
  const envPrefix = prefix ?? '';

  for (const mapping of ENV_MAPPINGS) {
    const envKey = envPrefix ? `${envPrefix}_${mapping.envKey}` : mapping.envKey;
    const value = process.env[envKey];
    if (value !== undefined && value !== '') {
      try {
        const transformed = mapping.transform(value);
        if (transformed !== undefined && !Number.isNaN(transformed)) {
          (config as Record<string, unknown>)[mapping.configKey] = transformed;
        }
      } catch {
        // Skip invalid env values
      }
    }
  }

  return config;
}

// ---------------------------------------------------------------------------
// Config Loader Class
// ---------------------------------------------------------------------------

export class ConfigLoader {
  private projectDir: string;
  private options: ConfigLoaderOptions;

  constructor(options: ConfigLoaderOptions = {}) {
    this.projectDir = options.projectDir ?? process.cwd();
    this.options = options;
  }

  /**
   * Load and merge configuration from all sources
   * Priority (highest to lowest):
   * 1. Environment variables
   * 2. Project local settings (.daemux/settings.local.json) - git-ignored
   * 3. Project settings (.daemux/settings.json)
   * 4. User settings (~/.daemux/settings.json)
   * 5. Default values
   */
  load(): Config {
    // Start with defaults
    let config: Partial<Config> = { ...DEFAULT_CONFIG };

    // Load user settings (lowest priority)
    if (!this.options.skipUser) {
      const userPath = getUserSettingsPath();
      const userSettings = loadJsonFile(userPath, SettingsFileSchema);
      if (userSettings) {
        config = { ...config, ...this.mapSettingsToConfig(userSettings) };
      }
    }

    // Load project settings
    if (!this.options.skipProject) {
      const projectPath = getProjectSettingsPath(this.projectDir);
      const projectSettings = loadJsonFile(projectPath, SettingsFileSchema);
      if (projectSettings) {
        config = { ...config, ...this.mapSettingsToConfig(projectSettings) };
      }

      // Load project local settings (overrides project settings)
      const localPath = getProjectLocalSettingsPath(this.projectDir);
      const localSettings = loadJsonFile(localPath, SettingsFileSchema);
      if (localSettings) {
        config = { ...config, ...this.mapSettingsToConfig(localSettings) };
      }
    }

    // Load environment variables (highest priority)
    if (!this.options.skipEnv) {
      const envConfig = loadEnvConfig(this.options.envPrefix);
      config = { ...config, ...envConfig };
    }

    // Set required defaults if not provided
    if (!config.agentId) {
      config.agentId = randomUUID();
    }
    if (!config.dataDir) {
      config.dataDir = join(homedir(), '.daemux');
    }

    // Validate final config
    const result = ConfigSchema.safeParse(config);
    if (!result.success) {
      throw new Error(`Invalid configuration: ${result.error.message}`);
    }

    return result.data;
  }

  /**
   * Get the resolved data directory
   */
  getDataDir(): string {
    const envDir = process.env.AGENT_DATA_DIR;
    if (envDir) return envDir;

    // Check for project .daemux directory
    const projectAgentDir = join(this.projectDir, '.daemux');
    if (existsSync(projectAgentDir)) {
      return projectAgentDir;
    }

    // Default to user home
    return join(homedir(), '.daemux');
  }

  /**
   * Get paths for plugin discovery
   */
  getPluginPaths(): string[] {
    const paths: string[] = [];

    // User plugins
    paths.push(join(homedir(), '.daemux', 'plugins'));

    // Project plugins
    paths.push(join(this.projectDir, '.daemux', 'plugins'));

    return paths;
  }

  private mapSettingsToConfig(settings: SettingsFile): Partial<Config> {
    const SETTINGS_KEYS: Array<keyof SettingsFile> = [
      'model', 'compactionThreshold', 'effectiveContextWindow',
      'queueMode', 'collectWindowMs', 'hookTimeoutMs', 'turnTimeoutMs',
      'debug', 'mcpDebug', 'heartbeatIntervalMs', 'heartbeatEnabled',
      'maxConcurrentTasks', 'workPollingIntervalMs',
      'workBudgetMaxTasksPerHour',
    ];

    const config: Partial<Config> = {};
    for (const key of SETTINGS_KEYS) {
      if (settings[key] !== undefined) {
        (config as Record<string, unknown>)[key] = settings[key];
      }
    }
    return config;
  }
}

// ---------------------------------------------------------------------------
// Convenience Functions
// ---------------------------------------------------------------------------

let globalConfig: Config | null = null;

export function loadConfig(options?: ConfigLoaderOptions): Config {
  const loader = new ConfigLoader(options);
  globalConfig = loader.load();
  return globalConfig;
}

export function getConfig(): Config {
  if (!globalConfig) {
    return loadConfig();
  }
  return globalConfig;
}

export function setConfig(config: Partial<Config>): Config {
  const current = getConfig();
  const merged = { ...current, ...config };
  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new Error(`Invalid configuration: ${result.error.message}`);
  }
  globalConfig = result.data;
  return globalConfig;
}
