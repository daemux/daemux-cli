/**
 * Updater Orchestration
 * Coordinates manifest checks, downloads, verification, and installation
 */

import { join } from 'path';
import { homedir } from 'os';
import { getLogger } from '../infra/logger';
import { fetchManifest, getCachedManifest, detectPlatform } from './manifest';
import { downloadUpdate } from './downloader';
import { verifyChecksum } from './verifier';
import { installVersion, activateVersion, cleanupOldVersions } from './installer';
import { isNewerVersion } from './utils';
import { loadStateSync, persistState } from './state';
import type { UpdateState, UpdateCheckResult, PlatformArtifact } from './types';

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export type {
  UpdateState,
  UpdateCheckResult,
  PlatformManifest,
  PlatformKey,
  PlatformArtifact,
} from './types';
export { verifyChecksum } from './verifier';
export { fetchManifest, getCachedManifest, detectPlatform } from './manifest';
export { downloadUpdate } from './downloader';
export {
  installVersion,
  activateVersion,
  cleanupOldVersions,
  rollbackVersion,
} from './installer';
export { isNewerVersion, isUpdateState } from './utils';
export { loadStateSync, persistState, defaultState } from './state';
export { acquireLock, releaseLock, isVersionLocked, cleanStaleLocks } from './pid-lock';
export type { LockStatus } from './pid-lock';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_STATE_DIR = join(homedir(), '.local', 'share', 'daemux');
const STATE_FILE = 'update-state.json';

// ---------------------------------------------------------------------------
// Updater Class
// ---------------------------------------------------------------------------

export class Updater {
  private readonly stateDir: string;
  private readonly statePath: string;
  private state: UpdateState;

  constructor(stateDir?: string) {
    this.stateDir = stateDir ?? DEFAULT_STATE_DIR;
    this.statePath = join(this.stateDir, STATE_FILE);
    this.state = loadStateSync(this.statePath);
  }

  // -------------------------------------------------------------------------
  // Background Check
  // -------------------------------------------------------------------------

  static checkInBackground(): void {
    const log = getLogger().child('updater');

    if (process.env['DISABLE_AUTOUPDATER'] === '1') {
      log.debug('Auto-updater disabled via environment');
      return;
    }

    const scriptPath = join(import.meta.dir, 'index.ts');

    try {
      const proc = Bun.spawn(['bun', 'run', scriptPath, '--check'], {
        stdout: 'ignore',
        stderr: 'ignore',
        stdin: 'ignore',
      });
      proc.unref();
      log.debug('Background update check spawned');
    } catch (err) {
      log.warn('Failed to spawn background update check', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Check for Updates
  // -------------------------------------------------------------------------

  async check(): Promise<UpdateCheckResult> {
    const log = getLogger().child('updater');

    try {
      const manifest = await fetchManifest();
      const currentVersion = this.state.currentVersion;

      this.setState({
        lastCheckTime: Date.now(),
      });

      if (!isNewerVersion(manifest.version, currentVersion)) {
        this.setState({ lastCheckResult: 'up-to-date' });
        log.info('Already up to date', {
          current: currentVersion,
          latest: manifest.version,
        });
        return {
          status: 'up-to-date',
          currentVersion,
          availableVersion: manifest.version,
        };
      }

      this.setState({
        lastCheckResult: 'update-available',
        availableVersion: manifest.version,
      });

      log.info('Update available', {
        current: currentVersion,
        available: manifest.version,
      });

      return {
        status: 'update-available',
        currentVersion,
        availableVersion: manifest.version,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.setState({ lastCheckResult: 'error' });
      log.error('Update check failed', { error: errorMsg });

      return {
        status: 'error',
        currentVersion: this.state.currentVersion,
        error: errorMsg,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Download and Verify
  // -------------------------------------------------------------------------

  async download(version: string): Promise<void> {
    const log = getLogger().child('updater');
    const manifest = await fetchManifest();

    if (manifest.version !== version) {
      const cached = await getCachedManifest();
      if (!cached || cached.version !== version) {
        throw new Error(`Version ${version} not found in manifest`);
      }
    }

    const platformKey = await detectPlatform();
    const artifact: PlatformArtifact | undefined =
      manifest.platforms[platformKey];

    if (!artifact) {
      throw new Error(`No artifact for platform ${platformKey}`);
    }

    log.info('Downloading update', { version, platform: platformKey });

    const downloadDir = join(this.stateDir, 'downloads');
    const filePath = await downloadUpdate(artifact, downloadDir);

    const { valid, actual } = await verifyChecksum(filePath, artifact.sha256);
    if (!valid) {
      throw new Error(
        `Checksum verification failed: expected ${artifact.sha256}, got ${actual}`
      );
    }

    this.setState({
      pendingUpdate: { version, path: filePath, verified: true },
    });

    log.info('Update downloaded and verified', { version, filePath });
  }

  // -------------------------------------------------------------------------
  // Apply Pending Update
  // -------------------------------------------------------------------------

  async apply(options?: { force?: boolean }): Promise<boolean> {
    const log = getLogger().child('updater');
    const pending = this.state.pendingUpdate;

    if (!pending) {
      log.warn('No pending update to apply');
      return false;
    }

    if (!pending.verified) {
      log.error('Pending update not verified, refusing to apply');
      return false;
    }

    log.info('Applying update', { version: pending.version });

    await installVersion(pending.path, pending.version);
    await activateVersion(pending.version);
    await cleanupOldVersions(undefined, options);

    this.setState({
      currentVersion: pending.version,
      pendingUpdate: undefined,
      lastCheckResult: 'up-to-date',
      availableVersion: undefined,
    });

    log.info('Update applied successfully', { version: pending.version });
    return true;
  }

  // -------------------------------------------------------------------------
  // State Management
  // -------------------------------------------------------------------------

  getState(): UpdateState {
    return { ...this.state };
  }

  setState(partial: Partial<UpdateState>): void {
    this.state = { ...this.state, ...partial };
    persistState(this.statePath, this.state);
  }

  hasPendingUpdate(): boolean {
    return this.state.pendingUpdate !== undefined
      && this.state.pendingUpdate.verified;
  }

}

// ---------------------------------------------------------------------------
// CLI Entry Point for Background Checks
// ---------------------------------------------------------------------------

if (import.meta.main && process.argv.includes('--check')) {
  const updater = new Updater();
  await updater.check();
}
