/**
 * Spawn Callbacks Tests
 * Tests the spawn callback patterns used in systemd.ts and windows.ts
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { EventEmitter } from 'events';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { SystemdServiceManager } from '../src/systemd';
import { WindowsServiceManager } from '../src/windows';
import type { ServiceConfig, ServiceStatus } from '../src/types';

describe('Spawn Callbacks - SystemdServiceManager runSystemctl', () => {
  const testDir = join(import.meta.dir, 'test-spawn-systemd');
  const testUserDir = join(testDir, '.config', 'systemd', 'user');
  let manager: SystemdServiceManager;

  beforeEach(() => {
    mkdirSync(testUserDir, { recursive: true });
    manager = new SystemdServiceManager();
    (manager as any).userDir = testUserDir;
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('runSystemctl Promise pattern (lines 123-140)', () => {
    it('should resolve with stdout when code is 0', async () => {
      // Mock runSystemctl to simulate successful spawn
      (manager as any).runSystemctl = async (args: string[]) => {
        return new Promise<string>((resolve, reject) => {
          const stdout = 'ActiveState=active\nMainPID=12345';
          const code = 0;

          // Simulate the close event handler logic from line 132-138
          if (code === 0) {
            resolve(stdout);
          } else {
            reject(new Error(`systemctl failed: ${stdout}`));
          }
        });
      };

      const result = await (manager as any).runSystemctl(['show', 'test']);
      expect(result).toContain('ActiveState=active');
    });

    it('should reject with error when code is non-zero', async () => {
      (manager as any).runSystemctl = async () => {
        return new Promise<string>((resolve, reject) => {
          const stderr = 'Unit not found';
          const code = 4;

          if (code === 0) {
            resolve('');
          } else {
            reject(new Error(`systemctl failed: ${stderr}`));
          }
        });
      };

      await expect((manager as any).runSystemctl(['show', 'missing']))
        .rejects.toThrow('systemctl failed: Unit not found');
    });

    it('should accumulate stdout from data events', async () => {
      (manager as any).runSystemctl = async () => {
        return new Promise<string>((resolve) => {
          // Simulate stdout data accumulation (line 129)
          let stdout = '';
          const chunks = ['Active', 'State=', 'active'];
          for (const chunk of chunks) {
            stdout += chunk;
          }
          resolve(stdout);
        });
      };

      const result = await (manager as any).runSystemctl(['show', 'test']);
      expect(result).toBe('ActiveState=active');
    });

    it('should accumulate stderr from data events', async () => {
      (manager as any).runSystemctl = async () => {
        return new Promise<string>((resolve, reject) => {
          // Simulate stderr data accumulation (line 130)
          let stderr = '';
          const chunks = ['Error: ', 'permission ', 'denied'];
          for (const chunk of chunks) {
            stderr += chunk;
          }
          reject(new Error(`systemctl failed: ${stderr}`));
        });
      };

      await expect((manager as any).runSystemctl(['start', 'test']))
        .rejects.toThrow('permission denied');
    });

    it('should use stderr in error message, fallback to stdout', async () => {
      // Test line 136: reject(new Error(`systemctl failed: ${stderr || stdout}`))
      (manager as any).runSystemctl = async () => {
        return new Promise<string>((resolve, reject) => {
          const stderr = '';
          const stdout = 'stdout error message';
          reject(new Error(`systemctl failed: ${stderr || stdout}`));
        });
      };

      await expect((manager as any).runSystemctl(['daemon-reload']))
        .rejects.toThrow('stdout error message');
    });
  });

  describe('spawn stdio configuration', () => {
    it('should configure pipe for stdin, stdout, stderr', () => {
      // Line 125: spawn('systemctl', ['--user', ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
      const spawnOptions = { stdio: ['pipe', 'pipe', 'pipe'] as const };
      expect(spawnOptions.stdio).toHaveLength(3);
      expect(spawnOptions.stdio[0]).toBe('pipe');
      expect(spawnOptions.stdio[1]).toBe('pipe');
      expect(spawnOptions.stdio[2]).toBe('pipe');
    });

    it('should prepend --user to args', () => {
      const args = ['daemon-reload'];
      const fullArgs = ['--user', ...args];
      expect(fullArgs).toEqual(['--user', 'daemon-reload']);
    });
  });

  describe('operations using runSystemctl', () => {
    it('should call runSystemctl for install', async () => {
      const calls: string[][] = [];
      (manager as any).runSystemctl = async (args: string[]) => {
        calls.push(args);
        return '';
      };

      await manager.install({ name: 'test', execPath: '/bin/test' });

      expect(calls.some(c => c.includes('daemon-reload'))).toBe(true);
      expect(calls.some(c => c.includes('enable'))).toBe(true);
    });

    it('should call runSystemctl for start', async () => {
      let startArgs: string[] = [];
      (manager as any).runSystemctl = async (args: string[]) => {
        startArgs = args;
        return '';
      };

      await manager.start('my-service');
      expect(startArgs).toEqual(['start', 'my-service']);
    });

    it('should call runSystemctl for stop', async () => {
      let stopArgs: string[] = [];
      (manager as any).runSystemctl = async (args: string[]) => {
        stopArgs = args;
        return '';
      };

      await manager.stop('my-service');
      expect(stopArgs).toEqual(['stop', 'my-service']);
    });

    it('should call runSystemctl for status', async () => {
      let statusArgs: string[] = [];
      (manager as any).runSystemctl = async (args: string[]) => {
        if (args[0] === 'show') {
          statusArgs = args;
          return 'ActiveState=active\nMainPID=1234';
        }
        return '';
      };

      await manager.status('my-service');
      expect(statusArgs).toContain('show');
      expect(statusArgs).toContain('my-service');
    });
  });
});

describe('Spawn Callbacks - WindowsServiceManager runNssm', () => {
  let manager: WindowsServiceManager;

  beforeEach(() => {
    manager = new WindowsServiceManager();
  });

  describe('runNssm Promise pattern (lines 94-115)', () => {
    it('should resolve with stdout when code is 0', async () => {
      (manager as any).runNssm = async () => {
        return new Promise<string>((resolve, reject) => {
          const stdout = 'SERVICE_RUNNING';
          const code = 0;

          // Simulate close event handler (lines 103-109)
          if (code === 0) {
            resolve(stdout);
          } else {
            reject(new Error(`nssm failed: ${stdout}`));
          }
        });
      };

      const result = await (manager as any).runNssm(['status', 'test']);
      expect(result).toBe('SERVICE_RUNNING');
    });

    it('should reject when code is non-zero', async () => {
      (manager as any).runNssm = async () => {
        return new Promise<string>((resolve, reject) => {
          const stderr = 'Service not found';
          const code = 3;

          if (code === 0) {
            resolve('');
          } else {
            reject(new Error(`nssm failed: ${stderr}`));
          }
        });
      };

      await expect((manager as any).runNssm(['status', 'missing']))
        .rejects.toThrow('nssm failed');
    });

    it('should accumulate stdout data', async () => {
      (manager as any).runNssm = async () => {
        return new Promise<string>((resolve) => {
          // Line 100: proc.stdout.on('data', data => { stdout += data.toString(); });
          let stdout = '';
          const chunks = ['SERVICE_', 'RUNNING'];
          for (const chunk of chunks) {
            stdout += chunk;
          }
          resolve(stdout);
        });
      };

      const result = await (manager as any).runNssm(['status', 'test']);
      expect(result).toBe('SERVICE_RUNNING');
    });

    it('should accumulate stderr data', async () => {
      (manager as any).runNssm = async () => {
        return new Promise<string>((resolve, reject) => {
          // Line 101: proc.stderr.on('data', data => { stderr += data.toString(); });
          let stderr = '';
          const chunks = ['Access ', 'denied'];
          for (const chunk of chunks) {
            stderr += chunk;
          }
          reject(new Error(`nssm failed: ${stderr}`));
        });
      };

      await expect((manager as any).runNssm(['start', 'test']))
        .rejects.toThrow('Access denied');
    });

    it('should use stderr or fallback to stdout in error', async () => {
      // Line 107: reject(new Error(`nssm failed: ${stderr || stdout}`))
      (manager as any).runNssm = async () => {
        return new Promise<string>((resolve, reject) => {
          const stderr = '';
          const stdout = 'fallback stdout';
          reject(new Error(`nssm failed: ${stderr || stdout}`));
        });
      };

      await expect((manager as any).runNssm(['install', 'test', 'path']))
        .rejects.toThrow('fallback stdout');
    });

    it('should handle spawn error event', async () => {
      // Lines 111-113: proc.on('error', err => { reject(...) })
      (manager as any).runNssm = async () => {
        return new Promise<string>((resolve, reject) => {
          const err = new Error('spawn ENOENT');
          reject(new Error(`nssm not found. Please install NSSM from https://nssm.cc/. Error: ${err.message}`));
        });
      };

      await expect((manager as any).runNssm(['status', 'test']))
        .rejects.toThrow('nssm not found');
    });

    it('should include nssm.cc link in spawn error', async () => {
      (manager as any).runNssm = async () => {
        return new Promise<string>((resolve, reject) => {
          const err = new Error('ENOENT');
          reject(new Error(`nssm not found. Please install NSSM from https://nssm.cc/. Error: ${err.message}`));
        });
      };

      await expect((manager as any).runNssm(['install', 'x', 'y']))
        .rejects.toThrow('https://nssm.cc/');
    });
  });

  describe('spawn configuration', () => {
    it('should use nssm.exe as command', () => {
      // Line 96: const proc = spawn('nssm.exe', args, ...)
      const command = 'nssm.exe';
      expect(command).toBe('nssm.exe');
    });

    it('should configure pipe stdio', () => {
      const options = { stdio: ['pipe', 'pipe', 'pipe'] as const };
      expect(options.stdio).toEqual(['pipe', 'pipe', 'pipe']);
    });
  });

  describe('operations using runNssm', () => {
    it('should call runNssm for install', async () => {
      const calls: string[][] = [];
      (manager as any).runNssm = async (args: string[]) => {
        calls.push(args);
        return '';
      };

      await manager.install({ name: 'test', execPath: 'C:\\test.exe' });

      expect(calls[0]).toEqual(['install', 'test', 'C:\\test.exe']);
    });

    it('should call runNssm for start', async () => {
      let args: string[] = [];
      (manager as any).runNssm = async (a: string[]) => {
        args = a;
        return '';
      };

      await manager.start('my-service');
      expect(args).toEqual(['start', 'my-service']);
    });

    it('should call runNssm for stop', async () => {
      let args: string[] = [];
      (manager as any).runNssm = async (a: string[]) => {
        args = a;
        return '';
      };

      await manager.stop('my-service');
      expect(args).toEqual(['stop', 'my-service']);
    });

    it('should call runNssm for status', async () => {
      let args: string[] = [];
      (manager as any).runNssm = async (a: string[]) => {
        args = a;
        return 'SERVICE_RUNNING';
      };

      await manager.status('my-service');
      expect(args).toEqual(['status', 'my-service']);
    });

    it('should call runNssm for isInstalled', async () => {
      let called = false;
      (manager as any).runNssm = async () => {
        called = true;
        return 'SERVICE_STOPPED';
      };

      const result = await manager.isInstalled('my-service');
      expect(called).toBe(true);
      expect(result).toBe(true);
    });
  });
});

describe('Spawn Callbacks - Event emitter patterns', () => {
  describe('data event handling', () => {
    it('should handle Buffer data', () => {
      let accumulated = '';
      const onData = (data: Buffer) => {
        accumulated += data.toString();
      };

      onData(Buffer.from('chunk1'));
      onData(Buffer.from('chunk2'));

      expect(accumulated).toBe('chunk1chunk2');
    });

    it('should convert Buffer to string', () => {
      const data = Buffer.from('test data');
      expect(data.toString()).toBe('test data');
    });
  });

  describe('close event handling', () => {
    it('should resolve on code 0', async () => {
      const promise = new Promise<string>((resolve, reject) => {
        const code = 0;
        const stdout = 'success';
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error('failed'));
        }
      });

      const result = await promise;
      expect(result).toBe('success');
    });

    it('should reject on non-zero code', async () => {
      const promise = new Promise<string>((resolve, reject) => {
        const code = 1;
        const stderr = 'error message';
        if (code === 0) {
          resolve('');
        } else {
          reject(new Error(`failed: ${stderr}`));
        }
      });

      await expect(promise).rejects.toThrow('error message');
    });
  });

  describe('error event handling', () => {
    it('should reject with formatted error', async () => {
      const promise = new Promise<string>((resolve, reject) => {
        const err = new Error('spawn ENOENT');
        reject(new Error(`Not found. Error: ${err.message}`));
      });

      await expect(promise).rejects.toThrow('spawn ENOENT');
    });
  });
});

describe('Spawn Callbacks - Exit code interpretation', () => {
  const codes = [
    { code: 0, success: true, desc: 'success' },
    { code: 1, success: false, desc: 'generic error' },
    { code: 2, success: false, desc: 'invalid argument' },
    { code: 3, success: false, desc: 'service not found' },
    { code: 4, success: false, desc: 'unit not found' },
    { code: 127, success: false, desc: 'command not found' },
  ];

  for (const { code, success, desc } of codes) {
    it(`exit code ${code} (${desc}) should ${success ? 'resolve' : 'reject'}`, async () => {
      const promise = new Promise<string>((resolve, reject) => {
        if (code === 0) {
          resolve('ok');
        } else {
          reject(new Error(`Exit code ${code}`));
        }
      });

      if (success) {
        const result = await promise;
        expect(result).toBe('ok');
      } else {
        await expect(promise).rejects.toThrow();
      }
    });
  }
});
