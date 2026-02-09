/**
 * PID Lock System
 * Prevents cleanupOldVersions() from deleting binaries that are still running
 */

import { join } from 'path';
import { homedir } from 'os';
import { mkdir, readdir, readFile, unlink } from 'fs/promises';
import { unlinkSync } from 'fs';

// ---------------------------------------------------------------------------
// Constants & Types
// ---------------------------------------------------------------------------

const DEFAULT_VERSIONS_DIR = join(homedir(), '.local', 'share', 'daemux', 'versions');

interface LockData {
  pid: number;
  version: string;
  startedAt: number;
}

export interface LockStatus {
  locked: boolean;
  pids: number[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLocksDir(versionsDir?: string): string {
  return join(versionsDir ?? DEFAULT_VERSIONS_DIR, 'locks');
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return true;
    return false;
  }
}

function tryUnlink(path: string): Promise<void> {
  return unlink(path).catch(() => {});
}

async function readLockFiles(locksDir: string): Promise<string[]> {
  try {
    const files = await readdir(locksDir);
    return files.filter(f => f.endsWith('.lock'));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Acquire / Release
// ---------------------------------------------------------------------------

export async function acquireLock(version: string, versionsDir?: string): Promise<void> {
  const locksDir = getLocksDir(versionsDir);
  await mkdir(locksDir, { recursive: true });

  const lockPath = join(locksDir, `${process.pid}.lock`);
  const data: LockData = { pid: process.pid, version, startedAt: Date.now() };
  await Bun.write(lockPath, JSON.stringify(data));
}

export function releaseLock(versionsDir?: string): void {
  try {
    unlinkSync(join(getLocksDir(versionsDir), `${process.pid}.lock`));
  } catch {
    // Already removed or never created
  }
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export async function isVersionLocked(
  version: string,
  versionsDir?: string
): Promise<LockStatus> {
  const locksDir = getLocksDir(versionsDir);
  const pids: number[] = [];

  for (const file of await readLockFiles(locksDir)) {
    try {
      const raw = await readFile(join(locksDir, file), 'utf-8');
      const data = JSON.parse(raw) as LockData;

      if (data.version !== version) continue;

      if (isPidAlive(data.pid)) {
        pids.push(data.pid);
      } else {
        await tryUnlink(join(locksDir, file));
      }
    } catch {
      await tryUnlink(join(locksDir, file));
    }
  }

  return { locked: pids.length > 0, pids };
}

// ---------------------------------------------------------------------------
// Stale Lock Cleanup
// ---------------------------------------------------------------------------

export async function cleanStaleLocks(versionsDir?: string): Promise<number> {
  const locksDir = getLocksDir(versionsDir);
  let removed = 0;

  for (const file of await readLockFiles(locksDir)) {
    try {
      const raw = await readFile(join(locksDir, file), 'utf-8');
      const data = JSON.parse(raw) as LockData;

      if (!isPidAlive(data.pid)) {
        await unlink(join(locksDir, file));
        removed++;
      }
    } catch {
      try {
        await unlink(join(locksDir, file));
        removed++;
      } catch { /* race ok */ }
    }
  }

  return removed;
}
