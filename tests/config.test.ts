/**
 * Configuration Unit Tests
 * Tests config loading, resolution, and validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ConfigLoader, loadConfig, getConfig, setConfig } from '../src/core/config';
import { ConfigSchema } from '../src/core/types';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { homedir } from 'os';

describe('Configuration', () => {
  const testDir = join(import.meta.dir, 'test-config-project');
  const testAgentDir = join(testDir, '.daemux');

  beforeEach(() => {
    // Create test directories
    mkdirSync(testAgentDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directories
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }

    // Clean up environment variables
    delete process.env.AGENT_MODEL;
    delete process.env.AGENT_DEBUG;
    delete process.env.AGENT_QUEUE_MODE;
    delete process.env.AGENT_ID;
    delete process.env.AGENT_DATA_DIR;
    delete process.env.AGENT_CONTEXT_WINDOW;
    delete process.env.AGENT_HEARTBEAT_ENABLED;
  });

  describe('ConfigSchema', () => {
    it('should validate a complete config', () => {
      const config = {
        agentId: 'test-agent',
        dataDir: '/tmp/agent',
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
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should apply defaults', () => {
      const config = {
        agentId: 'test-agent',
        dataDir: '/tmp/agent',
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        // Model now defaults to 'default' to let provider choose
        expect(result.data.model).toBe('default');
        expect(result.data.queueMode).toBe('steer');
      }
    });

    it('should accept any model string', () => {
      // Model field is now a free-form string to support any LLM provider
      const config = {
        agentId: 'test-agent',
        dataDir: '/tmp/agent',
        model: 'custom-model-from-any-provider',
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.model).toBe('custom-model-from-any-provider');
      }
    });

    it('should reject invalid compaction threshold', () => {
      const config = {
        agentId: 'test-agent',
        dataDir: '/tmp/agent',
        compactionThreshold: 1.5, // Must be between 0.5 and 0.95
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject empty agentId', () => {
      const config = {
        agentId: '',
        dataDir: '/tmp/agent',
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });
  });

  describe('ConfigLoader', () => {
    it('should load config with defaults', () => {
      const loader = new ConfigLoader({
        projectDir: testDir,
        skipEnv: true,
        skipUser: true,
      });

      const config = loader.load();

      expect(config.model).toBe('claude-sonnet-4-20250514');
      expect(config.queueMode).toBe('steer');
      expect(config.agentId).toBeDefined();
    });

    it('should load from project settings file', () => {
      const settingsPath = join(testAgentDir, 'settings.json');
      writeFileSync(settingsPath, JSON.stringify({
        model: 'claude-opus-4-20250514',
        debug: true,
      }));

      const loader = new ConfigLoader({
        projectDir: testDir,
        skipEnv: true,
        skipUser: true,
      });

      const config = loader.load();

      expect(config.model).toBe('claude-opus-4-20250514');
      expect(config.debug).toBe(true);
    });

    it('should override with local settings', () => {
      const settingsPath = join(testAgentDir, 'settings.json');
      const localSettingsPath = join(testAgentDir, 'settings.local.json');

      writeFileSync(settingsPath, JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        debug: false,
      }));

      writeFileSync(localSettingsPath, JSON.stringify({
        debug: true,
        queueMode: 'queue',
      }));

      const loader = new ConfigLoader({
        projectDir: testDir,
        skipEnv: true,
        skipUser: true,
      });

      const config = loader.load();

      expect(config.model).toBe('claude-sonnet-4-20250514');
      expect(config.debug).toBe(true);
      expect(config.queueMode).toBe('queue');
    });

    it('should override with environment variables', () => {
      process.env.AGENT_MODEL = 'claude-haiku-3-5-20250514';
      process.env.AGENT_DEBUG = 'true';

      const loader = new ConfigLoader({
        projectDir: testDir,
        skipUser: true,
      });

      const config = loader.load();

      expect(config.model).toBe('claude-haiku-3-5-20250514');
      expect(config.debug).toBe(true);
    });

    it('should respect priority order', () => {
      // Project settings
      const settingsPath = join(testAgentDir, 'settings.json');
      writeFileSync(settingsPath, JSON.stringify({
        model: 'claude-opus-4-20250514',
        debug: true,
      }));

      // Environment override
      process.env.AGENT_MODEL = 'claude-haiku-3-5-20250514';

      const loader = new ConfigLoader({
        projectDir: testDir,
        skipUser: true,
      });

      const config = loader.load();

      // Env should win
      expect(config.model).toBe('claude-haiku-3-5-20250514');
      // Project setting should remain
      expect(config.debug).toBe(true);
    });

    it('should handle invalid settings file gracefully', () => {
      const settingsPath = join(testAgentDir, 'settings.json');
      writeFileSync(settingsPath, 'not valid json');

      const loader = new ConfigLoader({
        projectDir: testDir,
        skipEnv: true,
        skipUser: true,
      });

      // Should not throw
      const config = loader.load();
      expect(config.model).toBe('claude-sonnet-4-20250514');
    });

    it('should generate agentId if not provided', () => {
      const loader = new ConfigLoader({
        projectDir: testDir,
        skipEnv: true,
        skipUser: true,
      });

      const config = loader.load();

      expect(config.agentId).toBeDefined();
      expect(config.agentId.length).toBeGreaterThan(0);
    });

    it('should use AGENT_ID from environment', () => {
      process.env.AGENT_ID = 'my-custom-agent';

      const loader = new ConfigLoader({
        projectDir: testDir,
        skipUser: true,
      });

      const config = loader.load();
      expect(config.agentId).toBe('my-custom-agent');
    });
  });

  describe('Config Data Dir Resolution', () => {
    it('should resolve data dir from environment', () => {
      process.env.AGENT_DATA_DIR = '/custom/data/dir';

      const loader = new ConfigLoader({
        projectDir: testDir,
      });

      const dataDir = loader.getDataDir();
      expect(dataDir).toBe('/custom/data/dir');
    });

    it('should use project .daemux dir if exists', () => {
      const loader = new ConfigLoader({
        projectDir: testDir,
      });

      const dataDir = loader.getDataDir();
      expect(dataDir).toBe(testAgentDir);
    });

    it('should fall back to home dir', () => {
      // Remove project .daemux dir
      rmSync(testAgentDir, { recursive: true });

      const loader = new ConfigLoader({
        projectDir: testDir,
      });

      const dataDir = loader.getDataDir();
      expect(dataDir).toBe(join(homedir(), '.daemux'));
    });
  });

  describe('Plugin Paths', () => {
    it('should return user and project plugin paths', () => {
      const loader = new ConfigLoader({
        projectDir: testDir,
      });

      const paths = loader.getPluginPaths();

      expect(paths).toContain(join(homedir(), '.daemux', 'plugins'));
      expect(paths).toContain(join(testDir, '.daemux', 'plugins'));
    });
  });

  describe('Global Config Functions', () => {
    it('should load and get global config', () => {
      const config = loadConfig({
        projectDir: testDir,
        skipEnv: true,
        skipUser: true,
      });

      const retrieved = getConfig();

      expect(retrieved).toEqual(config);
    });

    it('should set config values', () => {
      loadConfig({
        projectDir: testDir,
        skipEnv: true,
        skipUser: true,
      });

      const updated = setConfig({
        debug: true,
      });

      expect(updated.debug).toBe(true);
    });

    it('should reject invalid config updates', () => {
      loadConfig({
        projectDir: testDir,
        skipEnv: true,
        skipUser: true,
      });

      // Test with invalid compaction threshold
      expect(() => {
        setConfig({
          compactionThreshold: 1.5, // Invalid: must be between 0.5 and 0.95
        });
      }).toThrow();
    });
  });

  describe('Environment Variable Parsing', () => {
    it('should parse boolean env vars correctly', () => {
      process.env.AGENT_DEBUG = '1';
      process.env.AGENT_HEARTBEAT_ENABLED = 'true';

      const loader = new ConfigLoader({
        projectDir: testDir,
        skipUser: true,
      });

      const config = loader.load();

      expect(config.debug).toBe(true);
      expect(config.heartbeatEnabled).toBe(true);
    });

    it('should parse numeric env vars correctly', () => {
      process.env.AGENT_CONTEXT_WINDOW = '200000';

      const loader = new ConfigLoader({
        projectDir: testDir,
        skipUser: true,
      });

      const config = loader.load();

      expect(config.effectiveContextWindow).toBe(200000);
    });

    it('should ignore invalid numeric env vars', () => {
      process.env.AGENT_CONTEXT_WINDOW = 'not-a-number';

      const loader = new ConfigLoader({
        projectDir: testDir,
        skipUser: true,
      });

      const config = loader.load();

      // Should use default
      expect(config.effectiveContextWindow).toBe(180000);
    });
  });
});
