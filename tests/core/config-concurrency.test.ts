/**
 * Config Concurrency Tests
 * Tests for the maxConcurrentTasks configuration field
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ConfigLoader } from '../../src/core/config';
import { ConfigSchema } from '../../src/core/types';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';

describe('maxConcurrentTasks Configuration', () => {
  const testDir = join(import.meta.dir, 'test-config-concurrency-project');
  const testAgentDir = join(testDir, '.daemux');

  beforeEach(() => {
    mkdirSync(testAgentDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    delete process.env.AGENT_MAX_CONCURRENT_TASKS;
  });

  describe('ConfigSchema defaults', () => {
    it('should default maxConcurrentTasks to 3', () => {
      const config = {
        agentId: 'test-agent',
        dataDir: '/tmp/agent',
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxConcurrentTasks).toBe(3);
      }
    });

    it('should accept a custom maxConcurrentTasks value', () => {
      const config = {
        agentId: 'test-agent',
        dataDir: '/tmp/agent',
        maxConcurrentTasks: 10,
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxConcurrentTasks).toBe(10);
      }
    });

    it('should reject maxConcurrentTasks below 1', () => {
      const config = {
        agentId: 'test-agent',
        dataDir: '/tmp/agent',
        maxConcurrentTasks: 0,
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should reject maxConcurrentTasks above 20', () => {
      const config = {
        agentId: 'test-agent',
        dataDir: '/tmp/agent',
        maxConcurrentTasks: 21,
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('should accept boundary value 1', () => {
      const config = {
        agentId: 'test-agent',
        dataDir: '/tmp/agent',
        maxConcurrentTasks: 1,
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxConcurrentTasks).toBe(1);
      }
    });

    it('should accept boundary value 20', () => {
      const config = {
        agentId: 'test-agent',
        dataDir: '/tmp/agent',
        maxConcurrentTasks: 20,
      };

      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxConcurrentTasks).toBe(20);
      }
    });
  });

  describe('ConfigLoader with settings file', () => {
    it('should load maxConcurrentTasks from project settings', () => {
      const settingsPath = join(testAgentDir, 'settings.json');
      writeFileSync(settingsPath, JSON.stringify({
        maxConcurrentTasks: 7,
      }));

      const loader = new ConfigLoader({
        projectDir: testDir,
        skipEnv: true,
        skipUser: true,
      });

      const config = loader.load();
      expect(config.maxConcurrentTasks).toBe(7);
    });

    it('should use default when settings file omits maxConcurrentTasks', () => {
      const settingsPath = join(testAgentDir, 'settings.json');
      writeFileSync(settingsPath, JSON.stringify({
        debug: true,
      }));

      const loader = new ConfigLoader({
        projectDir: testDir,
        skipEnv: true,
        skipUser: true,
      });

      const config = loader.load();
      expect(config.maxConcurrentTasks).toBe(3);
    });
  });

  describe('Environment variable override', () => {
    it('should override maxConcurrentTasks from AGENT_MAX_CONCURRENT_TASKS', () => {
      process.env.AGENT_MAX_CONCURRENT_TASKS = '12';

      const loader = new ConfigLoader({
        projectDir: testDir,
        skipUser: true,
      });

      const config = loader.load();
      expect(config.maxConcurrentTasks).toBe(12);
    });

    it('should let env var override settings file', () => {
      const settingsPath = join(testAgentDir, 'settings.json');
      writeFileSync(settingsPath, JSON.stringify({
        maxConcurrentTasks: 5,
      }));

      process.env.AGENT_MAX_CONCURRENT_TASKS = '15';

      const loader = new ConfigLoader({
        projectDir: testDir,
        skipUser: true,
      });

      const config = loader.load();
      expect(config.maxConcurrentTasks).toBe(15);
    });

    it('should ignore invalid non-numeric env var value', () => {
      process.env.AGENT_MAX_CONCURRENT_TASKS = 'not-a-number';

      const loader = new ConfigLoader({
        projectDir: testDir,
        skipUser: true,
      });

      const config = loader.load();
      expect(config.maxConcurrentTasks).toBe(3);
    });
  });
});
