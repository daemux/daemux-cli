/**
 * PID Lock System
 * Prevents cleanupOldVersions() from deleting binaries that are still running
 */

import { join } from 'path';
import { homedir } from 'os';
import { mkdir, readdir, readFile, unlink } from 'fs/promises';
import { unlinkSync } from 'fs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_VERSIONS_DIR = join(homedir(), '.local', 'share', 'daemux', 'versions');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
// Acquire / Release
// ---------------------------------------------------------------------------

export async function acquireLock(version: string, versionsDir?: string): Promise<void> {
  const dir = versionsDir ?? DEFAULT_VERSIONS_DIR;
  const locksDir = join(dir, 'locks');
  await mkdir(locksDir, { recursive: true });

  const lockPath = join(locksDir, `${process.pid}.lock`);
  const data: LockData = {
    pid: process.pid,
    version,
    startedAt: Date.now(),
  };

  await Bun.write(lockPath, JSON.stringify(data));
}

export function releaseLock(versionsDir?: string): void {
  const dir = versionsDir ?? DEFAULT_VERSIONS_DIR;
  const lockPath = join(dir, 'locks', `${process.pid}.lock`);

  try {
    unlinkSync(lockPath);
  } catch {
    // Already removed or never created — safe to ignore
  }
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export async function isVersionLocked(
  version: string,
  versionsDir?: string
): Promise<LockStatus> {
  const dir = versionsDir ?? DEFAULT_VERSIONS_DIR;
  const locksDir = join(dir, 'locks');
  const pids: number[] = [];

  let files: string[];
  try {
    files = await readdir(locksDir);
  } catch {
    return { locked: false, pids: [] };
  }

  for (const file of files) {
    if (!file.endsWith('.lock')) continue;

    try {
      const raw = await readFile(join(locksDir, file), 'utf-8');
      const data = JSON.parse(raw) as LockData;

      if (data.version !== version) continue;

      if (isPidAlive(data.pid)) {
        pids.push(data.pid);
      } else {
        // Stale lock — clean it up
        try { await unlink(join(locksDir, file)); } catch { /* race ok */ }
      }
    } catch {
      // Corrupted lock file — remove it
      try { await unlink(join(locksDir, file)); } catch { /* race ok */ }
    }
  }

  return { locked: pids.length > 0, pids };
}

// ---------------------------------------------------------------------------
// Stale Lock Cleanup
// ---------------------------------------------------------------------------

export async function cleanStaleLocks(versionsDir?: string): Promise<number> {
  const dir = versionsDir ?? DEFAULT_VERSIONS_DIR;
  const locksDir = join(dir, 'locks');
  let removed = 0;

  let files: string[];
  try {
    files = await readdir(locksDir);
  } catch {
    return 0;
  }

  for (const file of files) {
    if (!file.endsWith('.lock')) continue;

    try {
      const raw = await readFile(join(locksDir, file), 'utf-8');
      const data = JSON.parse(raw) as LockData;

      if (!isPidAlive(data.pid)) {
        await unlink(join(locksDir, file));
        removed++;
      }
    } catch {
      // Corrupted — remove
      try {
        await unlink(join(locksDir, file));
        removed++;
      } catch { /* race ok */ }
    }
  }

  return removed;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    // EPERM = process exists but we lack permission (conservative: alive)
    if (code === 'EPERM') return true;
    // ESRCH = no such process
    return false;
  }
}
