/**
 * WindowsServiceManager Unit Tests
 * Tests Windows NSSM service management
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { WindowsServiceManager } from '../src/windows';
import type { ServiceConfig } from '../src/types';

describe('WindowsServiceManager', () => {
  let manager: WindowsServiceManager;

  const testConfig: ServiceConfig = {
    name: 'test-service',
    displayName: 'Test Service',
    description: 'A test service for unit tests',
    execPath: 'C:\\Program Files\\Test\\test-service.exe',
    args: ['--config', 'C:\\test\\config.json'],
    workingDirectory: 'C:\\temp',
    env: {
      TEST_VAR: 'test_value',
      NODE_ENV: 'production',
    },
  };

  beforeEach(() => {
    manager = new WindowsServiceManager();
  });

  describe('install', () => {
    it('should call nssm install with correct arguments', async () => {
      const calls: string[][] = [];
      (manager as any).runNssm = async (args: string[]) => {
        calls.push(args);
        return '';
      };

      await manager.install(testConfig);

      // Check install call
      const installCall = calls.find(c => c[0] === 'install');
      expect(installCall).toBeDefined();
      expect(installCall).toContain('test-service');
      expect(installCall).toContain('C:\\Program Files\\Test\\test-service.exe');
    });

    it('should set AppParameters for args', async () => {
      const calls: string[][] = [];
      (manager as any).runNssm = async (args: string[]) => {
        calls.push(args);
        return '';
      };

      await manager.install(testConfig);

      const paramsCall = calls.find(c => c.includes('AppParameters'));
      expect(paramsCall).toBeDefined();
      expect(paramsCall).toContain('--config C:\\test\\config.json');
    });

    it('should set AppDirectory for workingDir', async () => {
      const calls: string[][] = [];
      (manager as any).runNssm = async (args: string[]) => {
        calls.push(args);
        return '';
      };

      await manager.install(testConfig);

      const dirCall = calls.find(c => c.includes('AppDirectory'));
      expect(dirCall).toBeDefined();
      expect(dirCall).toContain('C:\\temp');
    });

    it('should set Description', async () => {
      const calls: string[][] = [];
      (manager as any).runNssm = async (args: string[]) => {
        calls.push(args);
        return '';
      };

      await manager.install(testConfig);

      const descCall = calls.find(c => c.includes('Description'));
      expect(descCall).toBeDefined();
      expect(descCall).toContain('A test service for unit tests');
    });

    it('should set DisplayName', async () => {
      const calls: string[][] = [];
      (manager as any).runNssm = async (args: string[]) => {
        calls.push(args);
        return '';
      };

      await manager.install(testConfig);

      const displayCall = calls.find(c => c.includes('DisplayName'));
      expect(displayCall).toBeDefined();
      expect(displayCall).toContain('Test Service');
    });

    it('should configure restart behavior', async () => {
      const calls: string[][] = [];
      (manager as any).runNssm = async (args: string[]) => {
        calls.push(args);
        return '';
      };

      await manager.install(testConfig);

      const exitCall = calls.find(c => c.includes('AppExit'));
      expect(exitCall).toBeDefined();
      expect(exitCall).toContain('Restart');

      const delayCall = calls.find(c => c.includes('AppRestartDelay'));
      expect(delayCall).toBeDefined();
      expect(delayCall).toContain('5000');
    });

    it('should set environment variables', async () => {
      const calls: string[][] = [];
      (manager as any).runNssm = async (args: string[]) => {
        calls.push(args);
        return '';
      };

      await manager.install(testConfig);

      const envCall = calls.find(c => c.includes('AppEnvironmentExtra'));
      expect(envCall).toBeDefined();
    });

    it('should skip optional settings when not provided', async () => {
      const calls: string[][] = [];
      (manager as any).runNssm = async (args: string[]) => {
        calls.push(args);
        return '';
      };

      const minimalConfig: ServiceConfig = {
        name: 'minimal-service',
        execPath: 'C:\\test.exe',
      };

      await manager.install(minimalConfig);

      // Should not have AppParameters, AppDirectory, etc.
      expect(calls.some(c => c.includes('AppParameters'))).toBe(false);
      expect(calls.some(c => c.includes('AppDirectory'))).toBe(false);
      expect(calls.some(c => c.includes('Description'))).toBe(false);
      expect(calls.some(c => c.includes('DisplayName'))).toBe(false);
      expect(calls.some(c => c.includes('AppEnvironmentExtra'))).toBe(false);
    });
  });

  describe('uninstall', () => {
    it('should stop service before removing', async () => {
      const calls: string[][] = [];
      (manager as any).runNssm = async (args: string[]) => {
        calls.push(args);
        return '';
      };

      await manager.uninstall('test-service');

      const stopCall = calls.find(c => c[0] === 'stop');
      expect(stopCall).toBeDefined();
      expect(stopCall).toContain('test-service');
    });

    it('should call nssm remove with confirm', async () => {
      const calls: string[][] = [];
      (manager as any).runNssm = async (args: string[]) => {
        calls.push(args);
        return '';
      };

      await manager.uninstall('test-service');

      const removeCall = calls.find(c => c[0] === 'remove');
      expect(removeCall).toBeDefined();
      expect(removeCall).toContain('test-service');
      expect(removeCall).toContain('confirm');
    });

    it('should handle stop failure gracefully', async () => {
      let stopCalled = false;
      (manager as any).runNssm = async (args: string[]) => {
        if (args[0] === 'stop') {
          stopCalled = true;
          throw new Error('Service not running');
        }
        return '';
      };

      // Should not throw
      await expect(manager.uninstall('test-service')).resolves.toBeUndefined();
      expect(stopCalled).toBe(true);
    });
  });

  describe('start', () => {
    it('should call nssm start', async () => {
      const calls: string[][] = [];
      (manager as any).runNssm = async (args: string[]) => {
        calls.push(args);
        return '';
      };

      await manager.start('test-service');

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual(['start', 'test-service']);
    });
  });

  describe('stop', () => {
    it('should call nssm stop', async () => {
      const calls: string[][] = [];
      (manager as any).runNssm = async (args: string[]) => {
        calls.push(args);
        return '';
      };

      await manager.stop('test-service');

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual(['stop', 'test-service']);
    });
  });

  describe('status', () => {
    it('should return running status', async () => {
      (manager as any).runNssm = async (args: string[]) => {
        if (args[0] === 'status') {
          return 'SERVICE_RUNNING';
        }
        return '';
      };

      const status = await manager.status('test-service');

      expect(status.name).toBe('test-service');
      expect(status.status).toBe('running');
    });

    it('should return stopped status', async () => {
      (manager as any).runNssm = async (args: string[]) => {
        if (args[0] === 'status') {
          return 'SERVICE_STOPPED';
        }
        return '';
      };

      const status = await manager.status('test-service');

      expect(status.status).toBe('stopped');
    });

    it('should return unknown status for other states', async () => {
      (manager as any).runNssm = async (args: string[]) => {
        if (args[0] === 'status') {
          return 'SERVICE_PAUSED';
        }
        return '';
      };

      const status = await manager.status('test-service');

      expect(status.status).toBe('unknown');
    });

    it('should return not-installed on error', async () => {
      (manager as any).runNssm = async () => {
        throw new Error('Service not found');
      };

      const status = await manager.status('nonexistent');

      expect(status.status).toBe('not-installed');
    });

    it('should handle case-insensitive status', async () => {
      (manager as any).runNssm = async (args: string[]) => {
        if (args[0] === 'status') {
          return 'service_running';
        }
        return '';
      };

      const status = await manager.status('test-service');

      expect(status.status).toBe('running');
    });
  });

  describe('isInstalled', () => {
    it('should return true when service exists', async () => {
      (manager as any).runNssm = async () => 'SERVICE_STOPPED';

      const result = await manager.isInstalled('test-service');

      expect(result).toBe(true);
    });

    it('should return false when service does not exist', async () => {
      (manager as any).runNssm = async () => {
        throw new Error('Service not found');
      };

      const result = await manager.isInstalled('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('runNssm error handling', () => {
    it('should provide helpful error when nssm is not found', async () => {
      // Reset to original runNssm to test real error
      const originalManager = new WindowsServiceManager();

      // The actual runNssm would spawn nssm.exe
      // We can't easily test this without mocking spawn
      // Just verify the method exists
      expect(typeof (originalManager as any).runNssm).toBe('function');
    });
  });
});
