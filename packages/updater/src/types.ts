/**
 * Type Definitions for the Auto-Updater System
 * Covers update state, platform manifests, and check results
 */

// ---------------------------------------------------------------------------
// Update State
// ---------------------------------------------------------------------------

export interface UpdateState {
  currentVersion: string;
  lastCheckTime: number;
  lastCheckResult: 'up-to-date' | 'update-available' | 'error';
  availableVersion?: string;
  pendingUpdate?: {
    version: string;
    path: string;
    verified: boolean;
  };
  checkIntervalMs: number;
  disabled: boolean;
}

// ---------------------------------------------------------------------------
// Platform Manifest
// ---------------------------------------------------------------------------

export interface PlatformManifest {
  version: string;
  released: string;
  minBunVersion: string;
  platforms: Record<PlatformKey, PlatformArtifact>;
}

export type PlatformKey =
  | 'darwin-arm64' | 'darwin-x64'
  | 'linux-arm64' | 'linux-x64'
  | 'linux-arm64-musl' | 'linux-x64-musl';

export interface PlatformArtifact {
  url: string;
  sha256: string;
  size: number;
}

// ---------------------------------------------------------------------------
// Update Check Result
// ---------------------------------------------------------------------------

export interface UpdateCheckResult {
  status: 'up-to-date' | 'update-available' | 'error';
  currentVersion: string;
  availableVersion?: string;
  error?: string;
}
