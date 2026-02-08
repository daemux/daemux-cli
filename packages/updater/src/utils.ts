/**
 * Updater Utility Functions
 * Version comparison and type guards for the update system
 */

import type { UpdateState } from './types';

/**
 * Compares two semver version strings.
 * Returns true if `available` is newer than `current`.
 */
export function isNewerVersion(available: string, current: string): boolean {
  const partsA = available.split('.').map(Number);
  const partsC = current.split('.').map(Number);
  const len = Math.max(partsA.length, partsC.length);

  for (let i = 0; i < len; i++) {
    const a = partsA[i] ?? 0;
    const c = partsC[i] ?? 0;
    if (a > c) return true;
    if (a < c) return false;
  }

  return false;
}

/**
 * Type guard that validates an unknown value as a valid UpdateState object.
 */
export function isUpdateState(value: unknown): value is UpdateState {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['currentVersion'] === 'string'
    && typeof obj['lastCheckTime'] === 'number'
    && typeof obj['checkIntervalMs'] === 'number'
  );
}
