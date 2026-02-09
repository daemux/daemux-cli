/**
 * Service Manager Integration Tests
 * Tests cross-platform service detection
 */

import { describe, it, expect } from 'bun:test';
import { ServiceManager, getServiceManager } from '../src/index';
import { platform } from 'os';

describe('ServiceManager', () => {
  describe('Platform Detection', () => {
    it('should detect current platform', () => {
      const manager = new ServiceManager();
      const detected = manager.getPlatform();

      // Should match the actual platform
      const actualPlatform = platform();
      expect(['linux', 'darwin', 'win32']).toContain(detected);

      if (actualPlatform === 'linux') {
        expect(detected).toBe('linux');
      } else if (actualPlatform === 'darwin') {
        expect(detected).toBe('darwin');
      } else if (actualPlatform === 'win32') {
        expect(detected).toBe('win32');
      }
    });

    it('should create appropriate manager for platform', () => {
      const manager = new ServiceManager();

      // The manager should be created without errors
      expect(manager).toBeDefined();
    });
  });

  describe('Service Operations', () => {
    it('should have install method', () => {
      const manager = new ServiceManager();
      expect(typeof manager.install).toBe('function');
    });

    it('should have uninstall method', () => {
      const manager = new ServiceManager();
      expect(typeof manager.uninstall).toBe('function');
    });

    it('should have start method', () => {
      const manager = new ServiceManager();
      expect(typeof manager.start).toBe('function');
    });

    it('should have stop method', () => {
      const manager = new ServiceManager();
      expect(typeof manager.stop).toBe('function');
    });

    it('should have restart method', () => {
      const manager = new ServiceManager();
      expect(typeof manager.restart).toBe('function');
    });

    it('should have status method', () => {
      const manager = new ServiceManager();
      expect(typeof manager.status).toBe('function');
    });

    it('should have isInstalled method', () => {
      const manager = new ServiceManager();
      expect(typeof manager.isInstalled).toBe('function');
    });
  });

  describe('Global Instance', () => {
    it('should return service manager instance', () => {
      const manager = getServiceManager();
      expect(manager).toBeInstanceOf(ServiceManager);
    });

    it('should return same instance on multiple calls', () => {
      const manager1 = getServiceManager();
      const manager2 = getServiceManager();
      expect(manager1).toBe(manager2);
    });
  });

  describe('Service Status Check', () => {
    it('should check if non-existent service is installed', async () => {
      const manager = new ServiceManager();

      const isInstalled = await manager.isInstalled('non-existent-service-12345');

      // Should not be installed
      expect(isInstalled).toBe(false);
    });

    it('should get status of non-existent service', async () => {
      const manager = new ServiceManager();

      const status = await manager.status('non-existent-service-12345');

      // Should indicate not installed or not running
      expect(status).toBeDefined();
      expect(status.status).toBe('not-installed');
    });
  });
});
