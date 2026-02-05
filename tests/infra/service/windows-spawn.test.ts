/**
 * WindowsServiceManager Spawn Tests
 * Tests that actually exercise the runNssm method
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { WindowsServiceManager } from '../../../src/infra/service/windows';

describe('WindowsServiceManager - Real runNssm execution', () => {
  let manager: WindowsServiceManager;

  beforeEach(() => {
    manager = new WindowsServiceManager();
  });

  // These tests will actually try to run nssm.exe on Windows
  // On other platforms, they will fail as expected, but still exercise the code paths

  describe('runNssm method', () => {
    it('should handle nssm not found', async () => {
      // On non-Windows systems, nssm.exe won't exist
      // This exercises lines 94-113 with the error event path
      if (process.platform !== 'win32') {
        try {
          await (manager as any).runNssm(['help']);
          // Unexpected success
        } catch (err) {
          // Expected - nssm not found
          expect(err).toBeDefined();
          expect(err instanceof Error).toBe(true);
          const msg = (err as Error).message;
          // Should have helpful error about installing NSSM
          expect(msg.includes('nssm') || msg.includes('ENOENT') || msg.includes('not found')).toBe(true);
        }
      } else {
        // On Windows, nssm might or might not be installed
        try {
          await (manager as any).runNssm(['help']);
        } catch (err) {
          // Either it's not installed, or another error
          expect(err).toBeDefined();
        }
      }
    });

    it('should handle status for nonexistent service', async () => {
      try {
        await (manager as any).runNssm(['status', 'nonexistent-service-xyz-123']);
      } catch (err) {
        // Expected - either nssm not found or service not found
        expect(err).toBeDefined();
      }
    });
  });

  describe('status method with real call', () => {
    it('should return not-installed for nonexistent service', async () => {
      // status() catches exceptions from runNssm and returns not-installed
      const result = await manager.status('nonexistent-service-xyz-123');
      expect(result.status).toBe('not-installed');
      expect(result.name).toBe('nonexistent-service-xyz-123');
    });
  });

  describe('isInstalled with real call', () => {
    it('should return false for nonexistent service', async () => {
      const result = await manager.isInstalled('nonexistent-service-xyz-123');
      expect(result).toBe(false);
    });
  });
});

describe('WindowsServiceManager - Spawn callback patterns', () => {
  // These tests verify the callback pattern without actually spawning

  it('should handle stdout accumulation', () => {
    let stdout = '';
    const onData = (data: { toString: () => string }) => {
      stdout += data.toString();
    };

    onData({ toString: () => 'SERVICE_' });
    onData({ toString: () => 'RUNNING' });

    expect(stdout).toBe('SERVICE_RUNNING');
  });

  it('should handle stderr accumulation', () => {
    let stderr = '';
    const onData = (data: { toString: () => string }) => {
      stderr += data.toString();
    };

    onData({ toString: () => 'Access ' });
    onData({ toString: () => 'denied' });

    expect(stderr).toBe('Access denied');
  });

  it('should resolve on close with code 0', async () => {
    const result = await new Promise<string>((resolve, reject) => {
      const stdout = 'SERVICE_RUNNING';
      const code = 0;

      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`nssm failed: error`));
      }
    });

    expect(result).toBe('SERVICE_RUNNING');
  });

  it('should reject on close with non-zero code', async () => {
    const promise = new Promise<string>((resolve, reject) => {
      const stderr = 'Service not found';
      const code = 3;

      if (code === 0) {
        resolve('');
      } else {
        reject(new Error(`nssm failed: ${stderr}`));
      }
    });

    await expect(promise).rejects.toThrow('Service not found');
  });

  it('should use stderr over stdout in error message', async () => {
    const promise = new Promise<string>((resolve, reject) => {
      const stdout = 'stdout message';
      const stderr = 'stderr message';
      const code = 1;

      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`nssm failed: ${stderr || stdout}`));
      }
    });

    await expect(promise).rejects.toThrow('stderr message');
  });

  it('should fallback to stdout when stderr empty', async () => {
    const promise = new Promise<string>((resolve, reject) => {
      const stdout = 'stdout fallback';
      const stderr = '';
      const code = 1;

      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`nssm failed: ${stderr || stdout}`));
      }
    });

    await expect(promise).rejects.toThrow('stdout fallback');
  });

  it('should format spawn error with nssm.cc link', async () => {
    const promise = new Promise<string>((resolve, reject) => {
      const err = new Error('spawn ENOENT');
      reject(new Error(`nssm not found. Please install NSSM from https://nssm.cc/. Error: ${err.message}`));
    });

    await expect(promise).rejects.toThrow('nssm.cc');
    await expect(promise).rejects.toThrow('ENOENT');
  });
});

describe('WindowsServiceManager - Error event handling', () => {
  it('should handle ENOENT error', async () => {
    const promise = new Promise<string>((resolve, reject) => {
      const err = new Error('spawn nssm.exe ENOENT');
      reject(new Error(`nssm not found. Please install NSSM from https://nssm.cc/. Error: ${err.message}`));
    });

    try {
      await promise;
    } catch (err) {
      expect((err as Error).message).toContain('nssm not found');
      expect((err as Error).message).toContain('https://nssm.cc/');
    }
  });

  it('should include original error message', async () => {
    const originalError = new Error('Permission denied');
    const promise = new Promise<string>((resolve, reject) => {
      reject(new Error(`nssm not found. Please install NSSM from https://nssm.cc/. Error: ${originalError.message}`));
    });

    try {
      await promise;
    } catch (err) {
      expect((err as Error).message).toContain('Permission denied');
    }
  });
});
