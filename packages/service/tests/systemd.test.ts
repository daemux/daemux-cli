/**
 * SystemdServiceManager Unit Tests
 * Tests Linux systemd service management
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { SystemdServiceManager } from '../src/systemd';
import type { ServiceConfig } from '../src/types';

describe('SystemdServiceManager', () => {
  const testDir = join(import.meta.dir, 'test-systemd-temp');
  const testUserDir = join(testDir, '.config', 'systemd', 'user');
  let manager: SystemdServiceManager;

  const testConfig: ServiceConfig = {
    name: 'test-service',
    displayName: 'Test Service',
    description: 'A test service for unit tests',
    execPath: '/usr/local/bin/test-service',
    args: ['--config', '/etc/test.conf'],
    workingDirectory: '/tmp',
    env: {
      TEST_VAR: 'test_value',
      NODE_ENV: 'production',
    },
  };

  beforeEach(() => {
    mkdirSync(testUserDir, { recursive: true });

    manager = new SystemdServiceManager();

    // Override private property for testing
    (manager as any).userDir = testUserDir;
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('getUnitPath', () => {
    it('should return correct unit path', () => {
      const path = (manager as any).getUnitPath('test-service');
      expect(path).toContain('test-service.service');
    });
  });

  describe('install', () => {
    it('should create unit file', async () => {
      (manager as any).runSystemctl = async () => '';

      await manager.install(testConfig);

      const unitPath = join(testUserDir, 'test-service.service');
      expect(existsSync(unitPath)).toBe(true);
    });

    it('should include [Unit] section', async () => {
      (manager as any).runSystemctl = async () => '';

      await manager.install(testConfig);

      const unitPath = join(testUserDir, 'test-service.service');
      const content = readFileSync(unitPath, 'utf-8');

      expect(content).toContain('[Unit]');
      expect(content).toContain('Description=A test service for unit tests');
      expect(content).toContain('After=network.target');
    });

    it('should include [Service] section', async () => {
      (manager as any).runSystemctl = async () => '';

      await manager.install(testConfig);

      const unitPath = join(testUserDir, 'test-service.service');
      const content = readFileSync(unitPath, 'utf-8');

      expect(content).toContain('[Service]');
      expect(content).toContain('Type=simple');
      expect(content).toContain('ExecStart=/usr/local/bin/test-service --config /etc/test.conf');
      expect(content).toContain('WorkingDirectory=/tmp');
      expect(content).toContain('Restart=on-failure');
      expect(content).toContain('RestartSec=5');
    });

    it('should include environment variables', async () => {
      (manager as any).runSystemctl = async () => '';

      await manager.install(testConfig);

      const unitPath = join(testUserDir, 'test-service.service');
      const content = readFileSync(unitPath, 'utf-8');

      expect(content).toContain('Environment="TEST_VAR=test_value"');
      expect(content).toContain('Environment="NODE_ENV=production"');
    });

    it('should include [Install] section', async () => {
      (manager as any).runSystemctl = async () => '';

      await manager.install(testConfig);

      const unitPath = join(testUserDir, 'test-service.service');
      const content = readFileSync(unitPath, 'utf-8');

      expect(content).toContain('[Install]');
      expect(content).toContain('WantedBy=default.target');
    });

    it('should call daemon-reload and enable', async () => {
      const calls: string[][] = [];
      (manager as any).runSystemctl = async (args: string[]) => {
        calls.push(args);
        return '';
      };

      await manager.install(testConfig);

      expect(calls.some(c => c.includes('daemon-reload'))).toBe(true);
      expect(calls.some(c => c.includes('enable'))).toBe(true);
    });

    it('should handle config without env', async () => {
      (manager as any).runSystemctl = async () => '';

      const configWithoutEnv: ServiceConfig = {
        name: 'test-no-env',
        execPath: '/usr/bin/test',
      };

      await manager.install(configWithoutEnv);

      const unitPath = join(testUserDir, 'test-no-env.service');
      const content = readFileSync(unitPath, 'utf-8');

      // Even without env, buildHardenedEnv adds PATH with ~/.local/bin and ~/.bun/bin
      expect(content).toContain('Environment="PATH=');
      expect(content).toContain('.local/bin');
      expect(content).toContain('.bun/bin');
      // Should not contain any other Environment lines besides PATH
      const envMatches = content.match(/Environment="/g);
      expect(envMatches?.length).toBe(1);
    });

    it('should handle config without args', async () => {
      (manager as any).runSystemctl = async () => '';

      const configWithoutArgs: ServiceConfig = {
        name: 'test-no-args',
        execPath: '/usr/bin/test',
      };

      await manager.install(configWithoutArgs);

      const unitPath = join(testUserDir, 'test-no-args.service');
      const content = readFileSync(unitPath, 'utf-8');

      expect(content).toContain('ExecStart=/usr/bin/test');
      expect(content).not.toContain('ExecStart=/usr/bin/test ');
    });

    it('should use homedir as default working directory', async () => {
      (manager as any).runSystemctl = async () => '';

      const configWithoutWorkingDir: ServiceConfig = {
        name: 'test-no-workdir',
        execPath: '/usr/bin/test',
      };

      await manager.install(configWithoutWorkingDir);

      const unitPath = join(testUserDir, 'test-no-workdir.service');
      const content = readFileSync(unitPath, 'utf-8');

      expect(content).toContain(`WorkingDirectory=${homedir()}`);
    });

    it('should use displayName for description if no description', async () => {
      (manager as any).runSystemctl = async () => '';

      const configWithDisplayName: ServiceConfig = {
        name: 'test-display',
        displayName: 'Display Name Service',
        execPath: '/usr/bin/test',
      };

      await manager.install(configWithDisplayName);

      const unitPath = join(testUserDir, 'test-display.service');
      const content = readFileSync(unitPath, 'utf-8');

      expect(content).toContain('Description=Display Name Service');
    });
  });

  describe('uninstall', () => {
    it('should remove unit file', async () => {
      const unitPath = join(testUserDir, 'test-service.service');
      writeFileSync(unitPath, '[Unit]\n');

      (manager as any).runSystemctl = async () => '';

      await manager.uninstall('test-service');

      expect(existsSync(unitPath)).toBe(false);
    });

    it('should call stop, disable, and daemon-reload', async () => {
      const unitPath = join(testUserDir, 'test-service.service');
      writeFileSync(unitPath, '[Unit]\n');

      const calls: string[][] = [];
      (manager as any).runSystemctl = async (args: string[]) => {
        calls.push(args);
        return '';
      };

      await manager.uninstall('test-service');

      expect(calls.some(c => c.includes('stop'))).toBe(true);
      expect(calls.some(c => c.includes('disable'))).toBe(true);
      expect(calls.some(c => c.includes('daemon-reload'))).toBe(true);
    });

    it('should handle non-existent unit', async () => {
      (manager as any).runSystemctl = async () => '';

      await expect(manager.uninstall('nonexistent')).resolves.toBeUndefined();
    });

    it('should handle stop failure gracefully', async () => {
      const unitPath = join(testUserDir, 'test-service.service');
      writeFileSync(unitPath, '[Unit]\n');

      (manager as any).runSystemctl = async (args: string[]) => {
        if (args.includes('stop')) {
          throw new Error('Service not running');
        }
        return '';
      };

      // Should not throw
      await expect(manager.uninstall('test-service')).resolves.toBeUndefined();
    });

    it('should handle disable failure gracefully', async () => {
      const unitPath = join(testUserDir, 'test-service.service');
      writeFileSync(unitPath, '[Unit]\n');

      (manager as any).runSystemctl = async (args: string[]) => {
        if (args.includes('disable')) {
          throw new Error('Service not enabled');
        }
        return '';
      };

      await expect(manager.uninstall('test-service')).resolves.toBeUndefined();
    });
  });

  describe('start', () => {
    it('should call systemctl start', async () => {
      const calls: string[][] = [];
      (manager as any).runSystemctl = async (args: string[]) => {
        calls.push(args);
        return '';
      };

      await manager.start('test-service');

      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain('start');
      expect(calls[0]).toContain('test-service');
    });
  });

  describe('stop', () => {
    it('should call systemctl stop', async () => {
      const calls: string[][] = [];
      (manager as any).runSystemctl = async (args: string[]) => {
        calls.push(args);
        return '';
      };

      await manager.stop('test-service');

      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain('stop');
      expect(calls[0]).toContain('test-service');
    });
  });

  describe('status', () => {
    it('should return running status', async () => {
      (manager as any).runSystemctl = async (args: string[]) => {
        if (args.includes('show')) {
          return 'ActiveState=active\nMainPID=12345\n';
        }
        return '';
      };

      const status = await manager.status('test-service');

      expect(status.name).toBe('test-service');
      expect(status.status).toBe('running');
      expect(status.pid).toBe(12345);
    });

    it('should return stopped status', async () => {
      (manager as any).runSystemctl = async (args: string[]) => {
        if (args.includes('show')) {
          return 'ActiveState=inactive\nMainPID=0\n';
        }
        return '';
      };

      const status = await manager.status('test-service');

      expect(status.status).toBe('stopped');
    });

    it('should return unknown status for other states', async () => {
      (manager as any).runSystemctl = async (args: string[]) => {
        if (args.includes('show')) {
          return 'ActiveState=failed\nMainPID=0\n';
        }
        return '';
      };

      const status = await manager.status('test-service');

      expect(status.status).toBe('unknown');
    });

    it('should return not-installed on error', async () => {
      (manager as any).runSystemctl = async () => {
        throw new Error('Unit not found');
      };

      const status = await manager.status('nonexistent');

      expect(status.status).toBe('not-installed');
    });

    it('should handle missing PID', async () => {
      (manager as any).runSystemctl = async (args: string[]) => {
        if (args.includes('show')) {
          return 'ActiveState=active\n';
        }
        return '';
      };

      const status = await manager.status('test-service');

      expect(status.pid).toBeUndefined();
    });
  });

  describe('isInstalled', () => {
    it('should return true when unit file exists', async () => {
      const unitPath = join(testUserDir, 'test-service.service');
      writeFileSync(unitPath, '[Unit]\n');

      const result = await manager.isInstalled('test-service');

      expect(result).toBe(true);
    });

    it('should return false when unit file does not exist', async () => {
      const result = await manager.isInstalled('nonexistent');

      expect(result).toBe(false);
    });
  });
});
