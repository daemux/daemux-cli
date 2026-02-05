/**
 * Service Manager Index Tests
 * Tests the cross-platform service manager
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { platform } from 'os';
import { ServiceManager, getServiceManager } from '../../../src/infra/service/index';

describe('ServiceManager Index', () => {
  describe('Platform Detection', () => {
    it('should detect current platform', () => {
      const manager = new ServiceManager();
      const detected = manager.getPlatform();

      expect(['linux', 'darwin', 'win32']).toContain(detected);
    });

    it('should match actual platform', () => {
      const manager = new ServiceManager();
      const detected = manager.getPlatform();
      const actual = platform();

      if (actual === 'linux' || actual === 'darwin' || actual === 'win32') {
        expect(detected).toBe(actual);
      }
    });
  });

  describe('Manager Creation', () => {
    it('should create manager without error', () => {
      expect(() => new ServiceManager()).not.toThrow();
    });

    it('should have all required methods', () => {
      const manager = new ServiceManager();

      expect(typeof manager.install).toBe('function');
      expect(typeof manager.uninstall).toBe('function');
      expect(typeof manager.start).toBe('function');
      expect(typeof manager.stop).toBe('function');
      expect(typeof manager.restart).toBe('function');
      expect(typeof manager.status).toBe('function');
      expect(typeof manager.isInstalled).toBe('function');
      expect(typeof manager.getPlatform).toBe('function');
    });
  });

  describe('restart', () => {
    it('should call stop then start', async () => {
      const manager = new ServiceManager();
      const calls: string[] = [];

      // Mock the internal methods
      (manager as any).manager = {
        stop: async () => { calls.push('stop'); },
        start: async () => { calls.push('start'); },
      };

      await manager.restart('test-service');

      expect(calls).toEqual(['stop', 'start']);
    });
  });

  describe('Delegation Methods', () => {
    it('install should delegate to platform manager', async () => {
      const manager = new ServiceManager();
      let called = false;

      (manager as any).manager = {
        install: async () => { called = true; },
      };

      await manager.install({
        name: 'test',
        execPath: '/usr/bin/test',
      });

      expect(called).toBe(true);
    });

    it('uninstall should delegate to platform manager', async () => {
      const manager = new ServiceManager();
      let calledWith = '';

      (manager as any).manager = {
        uninstall: async (name: string) => { calledWith = name; },
      };

      await manager.uninstall('test-service');

      expect(calledWith).toBe('test-service');
    });

    it('start should delegate to platform manager', async () => {
      const manager = new ServiceManager();
      let calledWith = '';

      (manager as any).manager = {
        start: async (name: string) => { calledWith = name; },
      };

      await manager.start('test-service');

      expect(calledWith).toBe('test-service');
    });

    it('stop should delegate to platform manager', async () => {
      const manager = new ServiceManager();
      let calledWith = '';

      (manager as any).manager = {
        stop: async (name: string) => { calledWith = name; },
      };

      await manager.stop('test-service');

      expect(calledWith).toBe('test-service');
    });

    it('status should delegate to platform manager', async () => {
      const manager = new ServiceManager();
      let calledWith = '';

      (manager as any).manager = {
        status: async (name: string) => {
          calledWith = name;
          return { name, status: 'running' };
        },
      };

      const result = await manager.status('test-service');

      expect(calledWith).toBe('test-service');
      expect(result.status).toBe('running');
    });

    it('isInstalled should delegate to platform manager', async () => {
      const manager = new ServiceManager();
      let calledWith = '';

      (manager as any).manager = {
        isInstalled: async (name: string) => {
          calledWith = name;
          return true;
        },
      };

      const result = await manager.isInstalled('test-service');

      expect(calledWith).toBe('test-service');
      expect(result).toBe(true);
    });
  });

  describe('Global Instance', () => {
    it('should return ServiceManager instance', () => {
      const manager = getServiceManager();
      expect(manager).toBeInstanceOf(ServiceManager);
    });

    it('should return same instance on multiple calls', () => {
      const manager1 = getServiceManager();
      const manager2 = getServiceManager();
      expect(manager1).toBe(manager2);
    });

    it('should have valid platform', () => {
      const manager = getServiceManager();
      const platform = manager.getPlatform();
      expect(['linux', 'darwin', 'win32']).toContain(platform);
    });
  });

  describe('Real Service Operations', () => {
    it('should check non-existent service is not installed', async () => {
      const manager = new ServiceManager();
      const result = await manager.isInstalled('definitely-not-a-real-service-12345');
      expect(result).toBe(false);
    });

    it('should get not-installed status for non-existent service', async () => {
      const manager = new ServiceManager();
      const status = await manager.status('definitely-not-a-real-service-12345');

      expect(status.name).toBe('definitely-not-a-real-service-12345');
      expect(status.status).toBe('not-installed');
    });
  });
});
