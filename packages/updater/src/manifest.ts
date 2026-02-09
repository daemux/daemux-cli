/**
 * Manifest Fetching, Caching, and Platform Detection
 * Downloads the release manifest and determines the correct platform artifact
 */

import { z } from 'zod';
import { join } from 'path';
import { homedir } from 'os';
import { mkdir } from 'fs/promises';
import { getLogger } from './logger';
import type { PlatformKey, PlatformManifest } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MANIFEST_URL = 'https://daemux.ai/manifest.json';
const STATE_DIR = join(homedir(), '.local', 'share', 'daemux');
const CACHED_MANIFEST_PATH = join(STATE_DIR, 'manifest.json');
const FETCH_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Zod Schema for Manifest Validation
// ---------------------------------------------------------------------------

const PlatformArtifactSchema = z.object({
  url: z.string().url(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i, 'Must be a 64-char hex SHA-256'),
  size: z.number().positive(),
});

const PlatformManifestSchema = z.object({
  version: z.string().min(1),
  released: z.string().min(1),
  minBunVersion: z.string().min(1),
  platforms: z.record(z.string(), PlatformArtifactSchema),
});

// ---------------------------------------------------------------------------
// Manifest URL Resolution
// ---------------------------------------------------------------------------

function getManifestUrl(): string {
  return process.env['DAEMUX_MANIFEST_URL'] ?? DEFAULT_MANIFEST_URL;
}

// ---------------------------------------------------------------------------
// Fetch Manifest from Remote
// ---------------------------------------------------------------------------

export async function fetchManifest(url?: string): Promise<PlatformManifest> {
  const log = getLogger().child('updater:manifest');
  const manifestUrl = url ?? getManifestUrl();

  log.debug('Fetching manifest', { url: manifestUrl });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(manifestUrl, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(
        `Manifest fetch failed: ${response.status} ${response.statusText}`
      );
    }

    const raw: unknown = await response.json();
    const manifest = PlatformManifestSchema.parse(raw) as PlatformManifest;

    await cacheManifest(manifest);
    log.info('Manifest fetched', { version: manifest.version });

    return manifest;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Manifest Cache
// ---------------------------------------------------------------------------

async function cacheManifest(manifest: PlatformManifest): Promise<void> {
  const log = getLogger().child('updater:manifest');

  try {
    await mkdir(STATE_DIR, { recursive: true });
    await Bun.write(CACHED_MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    log.debug('Manifest cached', { path: CACHED_MANIFEST_PATH });
  } catch (err) {
    log.warn('Failed to cache manifest', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getCachedManifest(): Promise<PlatformManifest | null> {
  const log = getLogger().child('updater:manifest');
  const file = Bun.file(CACHED_MANIFEST_PATH);
  const exists = await file.exists();

  if (!exists) {
    log.debug('No cached manifest found');
    return null;
  }

  try {
    const content = await file.text();
    const raw: unknown = JSON.parse(content);
    return PlatformManifestSchema.parse(raw) as PlatformManifest;
  } catch (err) {
    log.warn('Failed to read cached manifest', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Platform Detection
// ---------------------------------------------------------------------------

async function detectLibc(): Promise<'gnu' | 'musl'> {
  if (process.platform !== 'linux') {
    return 'gnu';
  }

  try {
    const proc = Bun.spawn(['ldd', '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stderr = await new Response(proc.stderr).text();
    const stdout = await new Response(proc.stdout).text();
    const combined = `${stdout}\n${stderr}`.toLowerCase();

    if (combined.includes('musl')) {
      return 'musl';
    }
  } catch {
    // Fall back to gnu if detection fails
  }

  return 'gnu';
}

export async function detectPlatform(): Promise<PlatformKey> {
  const os = process.platform;
  const arch = process.arch;

  if (os === 'darwin') {
    if (arch === 'arm64') return 'darwin-arm64';
    return 'darwin-x64';
  }

  if (os === 'linux') {
    const libc = await detectLibc();
    const suffix = libc === 'musl' ? '-musl' : '';

    if (arch === 'arm64') return `linux-arm64${suffix}` as PlatformKey;
    return `linux-x64${suffix}` as PlatformKey;
  }

  throw new Error(`Unsupported platform: ${os}-${arch}`);
}
