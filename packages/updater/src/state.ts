/**
 * Update State Persistence
 * Handles loading, saving, and default construction of UpdateState
 */

import { readFileSync } from 'fs';
import { getLogger } from './logger';
import { isUpdateState } from './utils';
import type { UpdateState } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CHECK_INTERVAL_MS = 1_800_000;

// ---------------------------------------------------------------------------
// State Persistence Functions
// ---------------------------------------------------------------------------

/**
 * Synchronously reads and parses update state from the given file path.
 * Returns default state if the file is missing or invalid.
 */
export function loadStateSync(path: string, currentVersion?: string): UpdateState {
  try {
    const content = readFileSync(path, 'utf-8');
    const parsed: unknown = JSON.parse(content);

    if (isUpdateState(parsed)) {
      return parsed;
    }
  } catch {
    // State file doesn't exist or is invalid - use defaults
  }

  return defaultState(currentVersion);
}

/**
 * Asynchronously writes the given state to disk as JSON.
 * Failures are logged as warnings but do not throw.
 */
export function persistState(path: string, state: UpdateState): void {
  Bun.write(path, JSON.stringify(state, null, 2))
    .catch(() => getLogger().child('updater').warn('Failed to persist update state'));
}

/**
 * Returns a fresh default UpdateState, respecting environment overrides.
 */
export function defaultState(currentVersion?: string): UpdateState {
  const parsed = parseInt(process.env['DAEMUX_UPDATE_INTERVAL_MS'] ?? '', 10);
  const checkIntervalMs = Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_CHECK_INTERVAL_MS;

  return {
    currentVersion: currentVersion ?? '0.0.0',
    lastCheckTime: 0,
    lastCheckResult: 'up-to-date',
    checkIntervalMs,
    disabled: process.env['DISABLE_AUTOUPDATER'] === '1',
  };
}
