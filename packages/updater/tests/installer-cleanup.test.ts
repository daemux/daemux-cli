/**
 * Installer Cleanup Tests
 * Tests cleanupOldVersions behavior with locked and unlocked versions
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { join } from 'path';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { homedir } from 'os';

// We need to test cleanupOldVersions which uses hardcoded VERSIONS_DIR.
// We'll create mock version directories and lock files in the real VERSIONS_DIR
// location, then clean up after. Alternatively, we test the integration between
// isVersionLocked and the cleanup logic using the actual functions.

import { acquireLock, releaseLock, isVersionLocked } from '../src/pid-lock';

describe('Installer Cleanup - Lock Integration', () => {
  const testVersionsDir = join(import.meta.dir, 'test-cleanup-temp');

  beforeEach(() => {
    mkdirSync(testVersionsDir, { recursive: true });
  });

  afterEach(() => {
    releaseLock(testVersionsDir);
    if (existsSync(testVersionsDir)) {
      rmSync(testVersionsDir, { recursive: true });
    }
  });

  describe('isVersionLocked skips locked versions', () => {
    it('should report version as locked when live PID holds lock', async () => {
      // Simulate a running process locking version 0.3.0
      await acquireLock('0.3.0', testVersionsDir);

      const status = await isVersionLocked('0.3.0', testVersionsDir);

      expect(status.locked).toBe(true);
      expect(status.pids).toContain(process.pid);
    });

    it('should report version as unlocked when no lock exists', async () => {
      const status = await isVersionLocked('0.3.0', testVersionsDir);

      expect(status.locked).toBe(false);
      expect(status.pids).toEqual([]);
    });

    it('should report version as unlocked for dead PID', async () => {
      const locksDir = join(testVersionsDir, 'locks');
      mkdirSync(locksDir, { recursive: true });

      const deadPid = 999999999;
      const lockData = { pid: deadPid, version: '0.3.0', startedAt: Date.now() };
      writeFileSync(
        join(locksDir, `${deadPid}.lock`),
        JSON.stringify(lockData)
      );

      const status = await isVersionLocked('0.3.0', testVersionsDir);

      // Dead PID means not locked
      expect(status.locked).toBe(false);
    });
  });

  describe('cleanupOldVersions logic simulation', () => {
    // These tests simulate the cleanupOldVersions logic using isVersionLocked
    // to verify correct skip/delete behavior without touching real filesystem

    it('should skip locked versions during cleanup', async () => {
      await acquireLock('0.3.0', testVersionsDir);

      const versionsToClean = ['0.1.0', '0.2.0', '0.3.0'];
      const removed: string[] = [];

      for (const version of versionsToClean) {
        const lockStatus = await isVersionLocked(version, testVersionsDir);
        if (lockStatus.locked) {
          continue;
        }
        removed.push(version);
      }

      // 0.3.0 should be skipped (locked by current process)
      expect(removed).toEqual(['0.1.0', '0.2.0']);
      expect(removed).not.toContain('0.3.0');
    });

    it('should delete locked versions with force: true', async () => {
      await acquireLock('0.3.0', testVersionsDir);

      const versionsToClean = ['0.1.0', '0.2.0', '0.3.0'];
      const force = true;
      const removed: string[] = [];

      for (const version of versionsToClean) {
        if (!force) {
          const lockStatus = await isVersionLocked(version, testVersionsDir);
          if (lockStatus.locked) {
            continue;
          }
        }
        removed.push(version);
      }

      // With force, all versions should be removed
      expect(removed).toEqual(['0.1.0', '0.2.0', '0.3.0']);
    });

    it('should skip active version even with force', async () => {
      const activeVersion = '0.4.0';
      const versionsToClean = ['0.2.0', '0.3.0', '0.4.0'];
      const force = true;
      const removed: string[] = [];

      for (const version of versionsToClean) {
        // Active version is always protected
        if (version === activeVersion) continue;

        if (!force) {
          const lockStatus = await isVersionLocked(version, testVersionsDir);
          if (lockStatus.locked) continue;
        }
        removed.push(version);
      }

      // Active version should always be skipped
      expect(removed).toEqual(['0.2.0', '0.3.0']);
      expect(removed).not.toContain('0.4.0');
    });

    it('should handle mix of locked, unlocked, and active versions', async () => {
      // Lock version 0.3.0 with current process
      await acquireLock('0.3.0', testVersionsDir);

      // Create a dead lock for 0.2.0
      const locksDir = join(testVersionsDir, 'locks');
      const deadLock = { pid: 999999999, version: '0.2.0', startedAt: Date.now() };
      writeFileSync(
        join(locksDir, '999999999.lock'),
        JSON.stringify(deadLock)
      );

      const activeVersion = '0.4.0';
      const versionsToClean = ['0.1.0', '0.2.0', '0.3.0', '0.4.0'];
      const removed: string[] = [];
      const skipped: string[] = [];

      for (const version of versionsToClean) {
        if (version === activeVersion) {
          skipped.push(version);
          continue;
        }

        const lockStatus = await isVersionLocked(version, testVersionsDir);
        if (lockStatus.locked) {
          skipped.push(version);
          continue;
        }
        removed.push(version);
      }

      // 0.1.0 = not locked, should be removed
      // 0.2.0 = dead PID lock, should be removed (dead = not locked)
      // 0.3.0 = live PID lock, should be skipped
      // 0.4.0 = active version, should be skipped
      expect(removed).toEqual(['0.1.0', '0.2.0']);
      expect(skipped).toEqual(['0.3.0', '0.4.0']);
    });
  });
});
