/**
 * LaunchdServiceManager Unit Tests
 * Tests macOS launchd service management
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { LaunchdServiceManager } from '../../../src/infra/service/launchd';
import type { ServiceConfig } from '../../../src/infra/service/types';

describe('LaunchdServiceManager', () => {
  const testDir = join(import.meta.dir, 'test-launchd-temp');
  const testAgentsDir = join(testDir, 'LaunchAgents');
  let manager: LaunchdServiceManager;

  const testConfig: ServiceConfig = {
    name: 'com.test.service',
    displayName: 'Test Service',
    description: 'A test service for unit tests',
    execPath: '/usr/local/bin/test-service',
    args: ['--config', '/etc/test.conf'],
    workingDir: '/tmp',
    env: {
      TEST_VAR: 'test_value',
      NODE_ENV: 'production',
    },
  };

  beforeEach(() => {
    mkdirSync(testAgentsDir, { recursive: true });

    // Create manager with mocked paths
    manager = new LaunchdServiceManager();

    // Override private property for testing
    (manager as any).agentsDir = testAgentsDir;
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('getPlistPath', () => {
    it('should return correct plist path', () => {
      const path = (manager as any).getPlistPath('com.test.service');
      expect(path).toContain('com.test.service.plist');
    });
  });

  describe('escapeXml', () => {
    it('should escape XML special characters', () => {
      const escape = (manager as any).escapeXml.bind(manager);

      expect(escape('&')).toBe('&amp;');
      expect(escape('<')).toBe('&lt;');
      expect(escape('>')).toBe('&gt;');
      expect(escape('"')).toBe('&quot;');
      expect(escape("'")).toBe('&apos;');
    });

    it('should escape multiple characters', () => {
      const escape = (manager as any).escapeXml.bind(manager);
      const result = escape('<script>"test" & \'value\'</script>');

      expect(result).toBe('&lt;script&gt;&quot;test&quot; &amp; &apos;value&apos;&lt;/script&gt;');
    });

    it('should handle strings without special characters', () => {
      const escape = (manager as any).escapeXml.bind(manager);
      expect(escape('normal text')).toBe('normal text');
    });
  });

  describe('install', () => {
    it('should create plist file', async () => {
      // Override runLaunchctl to avoid actual system calls
      (manager as any).runLaunchctl = async () => '';

      await manager.install(testConfig);

      const plistPath = join(testAgentsDir, 'com.test.service.plist');
      expect(existsSync(plistPath)).toBe(true);
    });

    it('should include service name as label', async () => {
      (manager as any).runLaunchctl = async () => '';

      await manager.install(testConfig);

      const plistPath = join(testAgentsDir, 'com.test.service.plist');
      const content = readFileSync(plistPath, 'utf-8');

      expect(content).toContain('<key>Label</key>');
      expect(content).toContain('<string>com.test.service</string>');
    });

    it('should include program arguments', async () => {
      (manager as any).runLaunchctl = async () => '';

      await manager.install(testConfig);

      const plistPath = join(testAgentsDir, 'com.test.service.plist');
      const content = readFileSync(plistPath, 'utf-8');

      expect(content).toContain('<key>ProgramArguments</key>');
      expect(content).toContain('/usr/local/bin/test-service');
      expect(content).toContain('--config');
      expect(content).toContain('/etc/test.conf');
    });

    it('should include environment variables', async () => {
      (manager as any).runLaunchctl = async () => '';

      await manager.install(testConfig);

      const plistPath = join(testAgentsDir, 'com.test.service.plist');
      const content = readFileSync(plistPath, 'utf-8');

      expect(content).toContain('<key>EnvironmentVariables</key>');
      expect(content).toContain('<key>TEST_VAR</key>');
      expect(content).toContain('<string>test_value</string>');
    });

    it('should include working directory', async () => {
      (manager as any).runLaunchctl = async () => '';

      await manager.install(testConfig);

      const plistPath = join(testAgentsDir, 'com.test.service.plist');
      const content = readFileSync(plistPath, 'utf-8');

      expect(content).toContain('<key>WorkingDirectory</key>');
      expect(content).toContain('<string>/tmp</string>');
    });

    it('should set RunAtLoad to true', async () => {
      (manager as any).runLaunchctl = async () => '';

      await manager.install(testConfig);

      const plistPath = join(testAgentsDir, 'com.test.service.plist');
      const content = readFileSync(plistPath, 'utf-8');

      expect(content).toContain('<key>RunAtLoad</key>');
      expect(content).toContain('<true/>');
    });

    it('should set KeepAlive to true', async () => {
      (manager as any).runLaunchctl = async () => '';

      await manager.install(testConfig);

      const plistPath = join(testAgentsDir, 'com.test.service.plist');
      const content = readFileSync(plistPath, 'utf-8');

      expect(content).toContain('<key>KeepAlive</key>');
      expect(content).toContain('<true/>');
    });

    it('should handle config without env', async () => {
      (manager as any).runLaunchctl = async () => '';

      const configWithoutEnv: ServiceConfig = {
        name: 'test-no-env',
        execPath: '/usr/bin/test',
      };

      await manager.install(configWithoutEnv);

      const plistPath = join(testAgentsDir, 'test-no-env.plist');
      expect(existsSync(plistPath)).toBe(true);
    });

    it('should handle config without args', async () => {
      (manager as any).runLaunchctl = async () => '';

      const configWithoutArgs: ServiceConfig = {
        name: 'test-no-args',
        execPath: '/usr/bin/test',
      };

      await manager.install(configWithoutArgs);

      const plistPath = join(testAgentsDir, 'test-no-args.plist');
      const content = readFileSync(plistPath, 'utf-8');

      expect(content).toContain('/usr/bin/test');
    });

    it('should use homedir as default working directory', async () => {
      (manager as any).runLaunchctl = async () => '';

      const configWithoutWorkingDir: ServiceConfig = {
        name: 'test-no-workdir',
        execPath: '/usr/bin/test',
      };

      await manager.install(configWithoutWorkingDir);

      const plistPath = join(testAgentsDir, 'test-no-workdir.plist');
      const content = readFileSync(plistPath, 'utf-8');

      expect(content).toContain(`<string>${homedir()}</string>`);
    });
  });

  describe('uninstall', () => {
    it('should remove plist file', async () => {
      const plistPath = join(testAgentsDir, 'com.test.service.plist');
      writeFileSync(plistPath, '<?xml version="1.0"?>');

      (manager as any).runLaunchctl = async () => '';

      await manager.uninstall('com.test.service');

      expect(existsSync(plistPath)).toBe(false);
    });

    it('should handle non-existent plist', async () => {
      (manager as any).runLaunchctl = async () => '';

      // Should not throw
      await expect(manager.uninstall('nonexistent')).resolves.toBeUndefined();
    });

    it('should handle launchctl unload failure', async () => {
      const plistPath = join(testAgentsDir, 'com.test.service.plist');
      writeFileSync(plistPath, '<?xml version="1.0"?>');

      (manager as any).runLaunchctl = async (args: string[]) => {
        if (args[0] === 'unload') {
          throw new Error('Service not loaded');
        }
        return '';
      };

      // Should not throw, should still remove file
      await expect(manager.uninstall('com.test.service')).resolves.toBeUndefined();
      expect(existsSync(plistPath)).toBe(false);
    });
  });

  describe('start', () => {
    it('should call launchctl load', async () => {
      const calls: string[][] = [];
      (manager as any).runLaunchctl = async (args: string[]) => {
        calls.push(args);
        return '';
      };

      await manager.start('com.test.service');

      expect(calls).toHaveLength(1);
      expect(calls[0]?.[0]).toBe('load');
    });
  });

  describe('stop', () => {
    it('should call launchctl unload', async () => {
      const calls: string[][] = [];
      (manager as any).runLaunchctl = async (args: string[]) => {
        calls.push(args);
        return '';
      };

      await manager.stop('com.test.service');

      expect(calls).toHaveLength(1);
      expect(calls[0]?.[0]).toBe('unload');
    });
  });

  describe('status', () => {
    it('should return running status with PID', async () => {
      (manager as any).runLaunchctl = async (args: string[]) => {
        if (args[0] === 'list') {
          return '12345\t0\tcom.test.service\n';
        }
        return '';
      };

      const status = await manager.status('com.test.service');

      expect(status.name).toBe('com.test.service');
      expect(status.status).toBe('running');
      expect(status.pid).toBe(12345);
    });

    it('should return stopped status for dash PID', async () => {
      (manager as any).runLaunchctl = async (args: string[]) => {
        if (args[0] === 'list') {
          return '-\t0\tcom.test.service\n';
        }
        return '';
      };

      // Also need to mock isInstalled
      (manager as any).isInstalled = async () => true;

      const status = await manager.status('com.test.service');

      expect(status.status).toBe('stopped');
    });

    it('should return not-installed for unknown service', async () => {
      (manager as any).runLaunchctl = async () => '';
      (manager as any).isInstalled = async () => false;

      const status = await manager.status('unknown.service');

      expect(status.status).toBe('not-installed');
    });

    it('should handle launchctl list failure', async () => {
      (manager as any).runLaunchctl = async () => {
        throw new Error('launchctl failed');
      };

      const status = await manager.status('com.test.service');

      expect(status.status).toBe('not-installed');
    });
  });

  describe('isInstalled', () => {
    it('should return true when plist exists', async () => {
      const plistPath = join(testAgentsDir, 'com.test.service.plist');
      writeFileSync(plistPath, '<?xml version="1.0"?>');

      const result = await manager.isInstalled('com.test.service');

      expect(result).toBe(true);
    });

    it('should return false when plist does not exist', async () => {
      const result = await manager.isInstalled('nonexistent.service');

      expect(result).toBe(false);
    });
  });
});
