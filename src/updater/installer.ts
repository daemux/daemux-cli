/**
 * Version Installation and Activation
 * Handles tar extraction, atomic symlink swaps, cleanup, and rollback
 */

import { join } from 'path';
import { homedir } from 'os';
import { mkdir, readdir, rm, symlink, rename, lstat, readlink } from 'fs/promises';
import { getLogger } from '../infra/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VERSIONS_DIR = join(homedir(), '.local', 'share', 'daemux', 'versions');
const SYMLINK_PATH = join(homedir(), '.local', 'bin', 'daemux');
const DEFAULT_KEEP_COUNT = 3;

// ---------------------------------------------------------------------------
// Install Version (Extract Tarball)
// ---------------------------------------------------------------------------

export async function installVersion(
  tarballPath: string,
  version: string
): Promise<string> {
  const log = getLogger().child('updater:installer');
  const versionDir = join(VERSIONS_DIR, version);

  await mkdir(versionDir, { recursive: true });

  log.info('Extracting tarball', { tarballPath, versionDir });

  const proc = Bun.spawn(
    ['tar', 'xzf', tarballPath, '-C', versionDir],
    { stdout: 'pipe', stderr: 'pipe' }
  );

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    log.error('Tar extraction failed', { exitCode, stderr });
    throw new Error(`Tar extraction failed (exit ${exitCode}): ${stderr}`);
  }

  log.info('Version installed', { version, versionDir });
  return versionDir;
}

// ---------------------------------------------------------------------------
// Activate Version (Atomic Symlink Update)
// ---------------------------------------------------------------------------

export async function activateVersion(version: string): Promise<void> {
  const log = getLogger().child('updater:installer');
  const versionDir = join(VERSIONS_DIR, version);
  const binaryPath = join(versionDir, 'daemux');

  const file = Bun.file(binaryPath);
  const exists = await file.exists();
  if (!exists) {
    throw new Error(`Binary not found at ${binaryPath}`);
  }

  await mkdir(join(homedir(), '.local', 'bin'), { recursive: true });

  const tempLink = `${SYMLINK_PATH}.tmp-${Date.now()}`;

  try {
    await symlink(binaryPath, tempLink);
    await rename(tempLink, SYMLINK_PATH);
    log.info('Version activated', { version, symlink: SYMLINK_PATH });
  } catch (err) {
    try { await rm(tempLink); } catch { /* temp already gone */ }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Cleanup Old Versions
// ---------------------------------------------------------------------------

export async function cleanupOldVersions(
  keepCount?: number
): Promise<void> {
  const log = getLogger().child('updater:installer');
  const keep = keepCount ?? DEFAULT_KEEP_COUNT;

  let entries: string[];
  try {
    entries = await readdir(VERSIONS_DIR);
  } catch {
    log.debug('No versions directory to clean');
    return;
  }

  const activeVersion = await getActiveVersion();
  const sortedVersions = entries.sort(compareVersionsDesc);

  if (sortedVersions.length <= keep) {
    log.debug('No old versions to remove', { total: sortedVersions.length });
    return;
  }

  const toRemove = sortedVersions.slice(keep);

  for (const version of toRemove) {
    if (version === activeVersion) continue;

    const versionDir = join(VERSIONS_DIR, version);
    try {
      await rm(versionDir, { recursive: true, force: true });
      log.info('Removed old version', { version });
    } catch (err) {
      log.warn('Failed to remove version', {
        version,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Rollback Version
// ---------------------------------------------------------------------------

export async function rollbackVersion(
  previousVersion: string
): Promise<void> {
  const log = getLogger().child('updater:installer');
  const versionDir = join(VERSIONS_DIR, previousVersion);
  const binaryPath = join(versionDir, 'daemux');

  const file = Bun.file(binaryPath);
  const exists = await file.exists();
  if (!exists) {
    throw new Error(
      `Cannot rollback: binary not found for version ${previousVersion}`
    );
  }

  log.warn('Rolling back', { targetVersion: previousVersion });
  await activateVersion(previousVersion);
  log.info('Rollback complete', { version: previousVersion });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getActiveVersion(): Promise<string | null> {
  try {
    const stat = await lstat(SYMLINK_PATH);
    if (!stat.isSymbolicLink()) return null;

    const target = await readlink(SYMLINK_PATH);
    const parts = target.split('/');
    const versionsIdx = parts.indexOf('versions');
    if (versionsIdx === -1 || versionsIdx + 1 >= parts.length) return null;

    return parts[versionsIdx + 1] ?? null;
  } catch {
    return null;
  }
}

function compareVersionsDesc(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  const len = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < len; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numB !== numA) return numB - numA;
  }

  return 0;
}
