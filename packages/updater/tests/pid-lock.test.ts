/**
 * PID Lock System Tests
 * Tests lock acquisition, release, staleness detection, and cleanup
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import {
  acquireLock,
  releaseLock,
  isVersionLocked,
  cleanStaleLocks,
} from '../src/pid-lock';

describe('PID Lock System', () => {
  const testDir = join(import.meta.dir, 'test-pid-lock-temp');

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('acquireLock', () => {
    it('should create lock file with correct JSON content', async () => {
      const before = Date.now();
      await acquireLock('0.4.0', testDir);
      const after = Date.now();

      const lockPath = join(testDir, 'locks', `${process.pid}.lock`);
      expect(existsSync(lockPath)).toBe(true);

      const raw = readFileSync(lockPath, 'utf-8');
      const data = JSON.parse(raw);

      expect(data.pid).toBe(process.pid);
      expect(data.version).toBe('0.4.0');
      expect(data.startedAt).toBeGreaterThanOrEqual(before);
      expect(data.startedAt).toBeLessThanOrEqual(after);
    });

    it('should create locks directory if missing', async () => {
      const locksDir = join(testDir, 'locks');
      expect(existsSync(locksDir)).toBe(false);

      await acquireLock('1.0.0', testDir);

      expect(existsSync(locksDir)).toBe(true);
    });

    it('should overwrite existing lock for same PID', async () => {
      await acquireLock('0.3.0', testDir);
      await acquireLock('0.4.0', testDir);

      const lockPath = join(testDir, 'locks', `${process.pid}.lock`);
      const data = JSON.parse(readFileSync(lockPath, 'utf-8'));

      expect(data.version).toBe('0.4.0');
    });
  });

  describe('releaseLock', () => {
    it('should remove the lock file', async () => {
      await acquireLock('0.4.0', testDir);

      const lockPath = join(testDir, 'locks', `${process.pid}.lock`);
      expect(existsSync(lockPath)).toBe(true);

      releaseLock(testDir);

      expect(existsSync(lockPath)).toBe(false);
    });

    it('should be idempotent (double-release safe)', async () => {
      await acquireLock('0.4.0', testDir);

      releaseLock(testDir);
      // Second release should not throw
      expect(() => releaseLock(testDir)).not.toThrow();
    });

    it('should not throw when no lock exists', () => {
      expect(() => releaseLock(testDir)).not.toThrow();
    });
  });

  describe('isVersionLocked', () => {
    it('should return true for live PID', async () => {
      await acquireLock('0.4.0', testDir);

      const status = await isVersionLocked('0.4.0', testDir);

      expect(status.locked).toBe(true);
      expect(status.pids).toContain(process.pid);
    });

    it('should return false for dead PID', async () => {
      const locksDir = join(testDir, 'locks');
      mkdirSync(locksDir, { recursive: true });

      // Use a PID that almost certainly doesn't exist
      const deadPid = 999999999;
      const lockData = { pid: deadPid, version: '0.3.0', startedAt: Date.now() };
      writeFileSync(join(locksDir, `${deadPid}.lock`), JSON.stringify(lockData));

      const status = await isVersionLocked('0.3.0', testDir);

      expect(status.locked).toBe(false);
      expect(status.pids).toEqual([]);
    });

    it('should return false for different version', async () => {
      await acquireLock('0.4.0', testDir);

      const status = await isVersionLocked('0.3.0', testDir);

      expect(status.locked).toBe(false);
      expect(status.pids).toEqual([]);
    });

    it('should clean stale lock files automatically', async () => {
      const locksDir = join(testDir, 'locks');
      mkdirSync(locksDir, { recursive: true });

      const deadPid = 999999999;
      const staleLockPath = join(locksDir, `${deadPid}.lock`);
      const lockData = { pid: deadPid, version: '0.3.0', startedAt: Date.now() };
      writeFileSync(staleLockPath, JSON.stringify(lockData));

      expect(existsSync(staleLockPath)).toBe(true);

      await isVersionLocked('0.3.0', testDir);

      // Stale lock should be cleaned up
      expect(existsSync(staleLockPath)).toBe(false);
    });

    it('should return false when locks dir does not exist', async () => {
      const status = await isVersionLocked('0.4.0', join(testDir, 'nonexistent'));

      expect(status.locked).toBe(false);
      expect(status.pids).toEqual([]);
    });

    it('should handle corrupted lock files', async () => {
      const locksDir = join(testDir, 'locks');
      mkdirSync(locksDir, { recursive: true });

      const corruptPath = join(locksDir, '12345.lock');
      writeFileSync(corruptPath, 'not valid json');

      const status = await isVersionLocked('0.4.0', testDir);

      expect(status.locked).toBe(false);
      // Corrupted file should be removed
      expect(existsSync(corruptPath)).toBe(false);
    });

    it('should ignore non-lock files', async () => {
      const locksDir = join(testDir, 'locks');
      mkdirSync(locksDir, { recursive: true });

      writeFileSync(join(locksDir, 'readme.txt'), 'not a lock');

      const status = await isVersionLocked('0.4.0', testDir);

      expect(status.locked).toBe(false);
      // Non-lock file should still exist
      expect(existsSync(join(locksDir, 'readme.txt'))).toBe(true);
    });
  });

  describe('cleanStaleLocks', () => {
    it('should remove dead locks and return correct count', async () => {
      const locksDir = join(testDir, 'locks');
      mkdirSync(locksDir, { recursive: true });

      // Create two stale lock files with dead PIDs
      for (const pid of [999999998, 999999999]) {
        const lockData = { pid, version: '0.3.0', startedAt: Date.now() };
        writeFileSync(join(locksDir, `${pid}.lock`), JSON.stringify(lockData));
      }

      const removed = await cleanStaleLocks(testDir);

      expect(removed).toBe(2);
      expect(existsSync(join(locksDir, '999999998.lock'))).toBe(false);
      expect(existsSync(join(locksDir, '999999999.lock'))).toBe(false);
    });

    it('should keep alive locks', async () => {
      await acquireLock('0.4.0', testDir);

      const removed = await cleanStaleLocks(testDir);

      expect(removed).toBe(0);
      const lockPath = join(testDir, 'locks', `${process.pid}.lock`);
      expect(existsSync(lockPath)).toBe(true);
    });

    it('should handle mixed alive and dead locks', async () => {
      const locksDir = join(testDir, 'locks');
      mkdirSync(locksDir, { recursive: true });

      // Alive lock (current process)
      await acquireLock('0.4.0', testDir);

      // Dead lock
      const deadPid = 999999999;
      const lockData = { pid: deadPid, version: '0.3.0', startedAt: Date.now() };
      writeFileSync(join(locksDir, `${deadPid}.lock`), JSON.stringify(lockData));

      const removed = await cleanStaleLocks(testDir);

      expect(removed).toBe(1);
      // Current process lock should still exist
      expect(existsSync(join(locksDir, `${process.pid}.lock`))).toBe(true);
      // Dead lock should be removed
      expect(existsSync(join(locksDir, `${deadPid}.lock`))).toBe(false);
    });

    it('should return 0 when locks dir does not exist', async () => {
      const removed = await cleanStaleLocks(join(testDir, 'nonexistent'));

      expect(removed).toBe(0);
    });

    it('should handle corrupted lock files', async () => {
      const locksDir = join(testDir, 'locks');
      mkdirSync(locksDir, { recursive: true });

      writeFileSync(join(locksDir, '99999.lock'), 'not json');

      const removed = await cleanStaleLocks(testDir);

      expect(removed).toBe(1);
      expect(existsSync(join(locksDir, '99999.lock'))).toBe(false);
    });
  });

  describe('Multiple locks for same version', () => {
    it('should track multiple PIDs for same version', async () => {
      const locksDir = join(testDir, 'locks');
      mkdirSync(locksDir, { recursive: true });

      // Current process lock
      await acquireLock('0.4.0', testDir);

      // Simulate another process with a known-alive PID
      // process.pid is alive, so write another lock with pid=1 (init, always alive on Unix)
      const pid1Data = { pid: 1, version: '0.4.0', startedAt: Date.now() };
      writeFileSync(join(locksDir, '1.lock'), JSON.stringify(pid1Data));

      const status = await isVersionLocked('0.4.0', testDir);

      expect(status.locked).toBe(true);
      expect(status.pids.length).toBeGreaterThanOrEqual(2);
      expect(status.pids).toContain(process.pid);
      expect(status.pids).toContain(1);
    });
  });
});
