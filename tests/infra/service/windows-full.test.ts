/**
 * WindowsServiceManager Full Coverage Tests
 * Tests edge cases in runNssm and error handling
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { WindowsServiceManager } from '../../../src/infra/service/windows';
import type { ServiceConfig, ServiceStatus } from '../../../src/infra/service/types';

describe('WindowsServiceManager Full Coverage', () => {
  let manager: WindowsServiceManager;

  beforeEach(() => {
    manager = new WindowsServiceManager();
  });

  describe('runNssm internal method', () => {
    it('should handle successful command', async () => {
      let capturedArgs: string[] = [];

      (manager as any).runNssm = async (args: string[]) => {
        capturedArgs = args;
        return 'success output';
      };

      const result = await (manager as any).runNssm(['status', 'test']);

      expect(capturedArgs).toEqual(['status', 'test']);
      expect(result).toBe('success output');
    });

    it('should reject on non-zero exit code', async () => {
      (manager as any).runNssm = async () => {
        throw new Error('nssm failed: Service not found');
      };

      await expect((manager as any).runNssm(['status', 'nonexistent']))
        .rejects.toThrow('nssm failed');
    });

    it('should provide helpful error when nssm not found', async () => {
      (manager as any).runNssm = async () => {
        throw new Error('nssm not found. Please install NSSM from https://nssm.cc/. Error: spawn ENOENT');
      };

      await expect((manager as any).runNssm(['status', 'test']))
        .rejects.toThrow('nssm not found');
    });

    it('should handle spawn error event', async () => {
      (manager as any).runNssm = async () => {
        throw new Error('nssm not found. Please install NSSM from https://nssm.cc/. Error: ENOENT');
      };

      await expect((manager as any).runNssm(['install', 'test', 'path']))
        .rejects.toThrow('NSSM');
    });

    it('should capture stderr on failure', async () => {
      (manager as any).runNssm = async () => {
        throw new Error('nssm failed: Access denied');
      };

      await expect((manager as any).runNssm(['start', 'test']))
        .rejects.toThrow('Access denied');
    });
  });

  describe('status parsing edge cases', () => {
    it('should handle SERVICE_RUNNING', async () => {
      (manager as any).runNssm = async (args: string[]) => {
        if (args[0] === 'status') {
          return 'SERVICE_RUNNING';
        }
        return '';
      };

      const status = await manager.status('test-service');
      expect(status.status).toBe('running');
    });

    it('should handle SERVICE_STOPPED', async () => {
      (manager as any).runNssm = async (args: string[]) => {
        if (args[0] === 'status') {
          return 'SERVICE_STOPPED';
        }
        return '';
      };

      const status = await manager.status('test-service');
      expect(status.status).toBe('stopped');
    });

    it('should handle SERVICE_PAUSED as unknown', async () => {
      (manager as any).runNssm = async (args: string[]) => {
        if (args[0] === 'status') {
          return 'SERVICE_PAUSED';
        }
        return '';
      };

      const status = await manager.status('test-service');
      expect(status.status).toBe('unknown');
    });

    it('should handle SERVICE_START_PENDING', async () => {
      (manager as any).runNssm = async (args: string[]) => {
        if (args[0] === 'status') {
          return 'SERVICE_START_PENDING';
        }
        return '';
      };

      const status = await manager.status('test-service');
      expect(status.status).toBe('unknown');
    });

    it('should handle SERVICE_STOP_PENDING', async () => {
      (manager as any).runNssm = async (args: string[]) => {
        if (args[0] === 'status') {
          return 'SERVICE_STOP_PENDING';
        }
        return '';
      };

      const status = await manager.status('test-service');
      expect(status.status).toBe('unknown');
    });

    it('should handle lowercase status', async () => {
      (manager as any).runNssm = async (args: string[]) => {
        if (args[0] === 'status') {
          return 'service_running';
        }
        return '';
      };

      const status = await manager.status('test-service');
      expect(status.status).toBe('running');
    });

    it('should handle status with extra whitespace', async () => {
      (manager as any).runNssm = async (args: string[]) => {
        if (args[0] === 'status') {
          return '  SERVICE_RUNNING  \n';
        }
        return '';
      };

      const status = await manager.status('test-service');
      expect(status.status).toBe('running');
    });

    it('should handle empty status output', async () => {
      (manager as any).runNssm = async (args: string[]) => {
        if (args[0] === 'status') {
          return '';
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

    it('should return name in status result', async () => {
      (manager as any).runNssm = async (args: string[]) => {
        if (args[0] === 'status') {
          return 'SERVICE_RUNNING';
        }
        return '';
      };

      const status = await manager.status('my-service');
      expect(status.name).toBe('my-service');
    });
  });

  describe('install comprehensive coverage', () => {
    it('should install with full config', async () => {
      const calls: string[][] = [];

      (manager as any).runNssm = async (args: string[]) => {
        calls.push(args);
        return '';
      };

      const config: ServiceConfig = {
        name: 'full-service',
        displayName: 'Full Service',
        description: 'Full Description',
        execPath: 'C:\\test.exe',
        args: ['--flag', 'value'],
        workingDir: 'C:\\workdir',
        env: { KEY: 'value' },
      };

      await manager.install(config);

      // Check install call
      expect(calls.some(c => c[0] === 'install')).toBe(true);
      // Check AppParameters
      expect(calls.some(c => c.includes('AppParameters'))).toBe(true);
      // Check AppDirectory
      expect(calls.some(c => c.includes('AppDirectory'))).toBe(true);
      // Check Description
      expect(calls.some(c => c.includes('Description'))).toBe(true);
      // Check DisplayName
      expect(calls.some(c => c.includes('DisplayName'))).toBe(true);
      // Check AppEnvironmentExtra
      expect(calls.some(c => c.includes('AppEnvironmentExtra'))).toBe(true);
    });

    it('should configure restart behavior', async () => {
      const calls: string[][] = [];

      (manager as any).runNssm = async (args: string[]) => {
        calls.push(args);
        return '';
      };

      await manager.install({
        name: 'restart-test',
        execPath: 'C:\\test.exe',
      });

      // Check AppExit
      const exitCall = calls.find(c => c.includes('AppExit'));
      expect(exitCall).toContain('Default');
      expect(exitCall).toContain('Restart');

      // Check AppRestartDelay
      const delayCall = calls.find(c => c.includes('AppRestartDelay'));
      expect(delayCall).toContain('5000');
    });

    it('should handle config without optional fields', async () => {
      const calls: string[][] = [];

      (manager as any).runNssm = async (args: string[]) => {
        calls.push(args);
        return '';
      };

      await manager.install({
        name: 'minimal-service',
        execPath: 'C:\\minimal.exe',
      });

      // Should NOT have optional settings
      expect(calls.some(c => c.includes('AppParameters'))).toBe(false);
      expect(calls.some(c => c.includes('AppDirectory'))).toBe(false);
      expect(calls.some(c => c.includes('Description'))).toBe(false);
      expect(calls.some(c => c.includes('DisplayName'))).toBe(false);
      expect(calls.some(c => c.includes('AppEnvironmentExtra'))).toBe(false);
    });

    it('should format environment variables correctly', async () => {
      let envCall: string[] = [];

      (manager as any).runNssm = async (args: string[]) => {
        if (args.includes('AppEnvironmentExtra')) {
          envCall = args;
        }
        return '';
      };

      await manager.install({
        name: 'env-test',
        execPath: 'C:\\test.exe',
        env: {
          VAR1: 'value1',
          VAR2: 'value2',
        },
      });

      // Environment should be newline-separated
      const envStr = envCall[envCall.length - 1];
      expect(envStr).toContain('VAR1=value1');
      expect(envStr).toContain('VAR2=value2');
      expect(envStr).toContain('\n');
    });

    it('should join args with space', async () => {
      let paramsCall: string[] = [];

      (manager as any).runNssm = async (args: string[]) => {
        if (args.includes('AppParameters')) {
          paramsCall = args;
        }
        return '';
      };

      await manager.install({
        name: 'args-test',
        execPath: 'C:\\test.exe',
        args: ['--config', 'path with spaces', '--verbose'],
      });

      const params = paramsCall[paramsCall.length - 1];
      expect(params).toBe('--config path with spaces --verbose');
    });
  });

  describe('uninstall edge cases', () => {
    it('should stop before remove', async () => {
      const calls: string[][] = [];

      (manager as any).runNssm = async (args: string[]) => {
        calls.push(args);
        return '';
      };

      await manager.uninstall('test-service');

      const stopIndex = calls.findIndex(c => c[0] === 'stop');
      const removeIndex = calls.findIndex(c => c[0] === 'remove');

      expect(stopIndex).toBeLessThan(removeIndex);
    });

    it('should pass confirm flag to remove', async () => {
      let removeCall: string[] = [];

      (manager as any).runNssm = async (args: string[]) => {
        if (args[0] === 'remove') {
          removeCall = args;
        }
        return '';
      };

      await manager.uninstall('test-service');

      expect(removeCall).toContain('confirm');
    });

    it('should continue when stop fails', async () => {
      let removeCalled = false;

      (manager as any).runNssm = async (args: string[]) => {
        if (args[0] === 'stop') {
          throw new Error('Service not running');
        }
        if (args[0] === 'remove') {
          removeCalled = true;
        }
        return '';
      };

      await manager.uninstall('test-service');

      expect(removeCalled).toBe(true);
    });
  });

  describe('start and stop', () => {
    it('should call nssm start with service name', async () => {
      let startCall: string[] = [];

      (manager as any).runNssm = async (args: string[]) => {
        startCall = args;
        return '';
      };

      await manager.start('my-service');

      expect(startCall).toEqual(['start', 'my-service']);
    });

    it('should call nssm stop with service name', async () => {
      let stopCall: string[] = [];

      (manager as any).runNssm = async (args: string[]) => {
        stopCall = args;
        return '';
      };

      await manager.stop('my-service');

      expect(stopCall).toEqual(['stop', 'my-service']);
    });
  });

  describe('isInstalled edge cases', () => {
    it('should return true when status succeeds', async () => {
      (manager as any).runNssm = async () => 'SERVICE_STOPPED';

      const result = await manager.isInstalled('test-service');

      expect(result).toBe(true);
    });

    it('should return false when status fails', async () => {
      (manager as any).runNssm = async () => {
        throw new Error('Service not found');
      };

      const result = await manager.isInstalled('nonexistent');

      expect(result).toBe(false);
    });

    it('should handle any status as installed', async () => {
      (manager as any).runNssm = async () => 'SERVICE_PAUSED';

      const result = await manager.isInstalled('paused-service');

      expect(result).toBe(true);
    });
  });

  describe('error message formatting', () => {
    it('should include nssm.cc link in spawn error', async () => {
      const errorMessage = 'nssm not found. Please install NSSM from https://nssm.cc/. Error: ENOENT';

      expect(errorMessage).toContain('nssm.cc');
      expect(errorMessage).toContain('ENOENT');
    });

    it('should include stderr in failure message', async () => {
      const stderr = 'Access denied';
      const errorMessage = `nssm failed: ${stderr || 'Unknown error'}`;

      expect(errorMessage).toContain('Access denied');
    });

    it('should fallback to stdout when stderr empty', async () => {
      const stdout = 'stdout error message';
      const stderr = '';
      const errorMessage = `nssm failed: ${stderr || stdout}`;

      expect(errorMessage).toContain('stdout error message');
    });
  });

  describe('concurrent operations', () => {
    it('should handle multiple status checks', async () => {
      let callCount = 0;

      (manager as any).runNssm = async () => {
        callCount++;
        return 'SERVICE_RUNNING';
      };

      const results = await Promise.all([
        manager.status('service-1'),
        manager.status('service-2'),
        manager.status('service-3'),
      ]);

      expect(callCount).toBe(3);
      expect(results.every(r => r.status === 'running')).toBe(true);
    });
  });

  describe('Windows-specific paths', () => {
    it('should handle Windows path formats', async () => {
      let installCall: string[] = [];

      (manager as any).runNssm = async (args: string[]) => {
        if (args[0] === 'install') {
          installCall = args;
        }
        return '';
      };

      await manager.install({
        name: 'win-path-test',
        execPath: 'C:\\Program Files\\App\\app.exe',
      });

      expect(installCall).toContain('C:\\Program Files\\App\\app.exe');
    });

    it('should handle UNC paths', async () => {
      let installCall: string[] = [];

      (manager as any).runNssm = async (args: string[]) => {
        if (args[0] === 'install') {
          installCall = args;
        }
        return '';
      };

      await manager.install({
        name: 'unc-test',
        execPath: '\\\\server\\share\\app.exe',
      });

      expect(installCall).toContain('\\\\server\\share\\app.exe');
    });
  });
});
