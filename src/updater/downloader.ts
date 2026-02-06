/**
 * Update Artifact Downloader
 * Downloads release tarballs with progress streaming
 */

import { join } from 'path';
import { homedir } from 'os';
import { mkdir } from 'fs/promises';
import { getLogger } from '../infra/logger';
import type { PlatformArtifact } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DOWNLOADS_DIR = join(
  homedir(), '.local', 'share', 'daemux', 'downloads'
);
const FETCH_TIMEOUT_MS = 300_000;

// ---------------------------------------------------------------------------
// Temporary File Naming
// ---------------------------------------------------------------------------

function generateTempFilename(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  return `daemux-update-${timestamp}-${random}.tar.gz`;
}

// ---------------------------------------------------------------------------
// Streaming Read Loop
// ---------------------------------------------------------------------------

async function streamResponse(
  body: ReadableStream<Uint8Array>,
  totalSize: number,
  onProgress?: (pct: number) => void
): Promise<Uint8Array[]> {
  let received = 0;
  let lastReportedPct = -1;
  const chunks: Uint8Array[] = [];
  const reader = body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    received += value.byteLength;

    if (onProgress && totalSize > 0) {
      const pct = Math.min(Math.round((received / totalSize) * 100), 100);
      if (pct !== lastReportedPct) {
        lastReportedPct = pct;
        onProgress(pct);
      }
    }
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Download with Streaming Progress
// ---------------------------------------------------------------------------

export async function downloadUpdate(
  artifact: PlatformArtifact,
  destDir?: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  const log = getLogger().child('updater:downloader');
  const targetDir = destDir ?? DOWNLOADS_DIR;

  await mkdir(targetDir, { recursive: true });

  const tempFilename = generateTempFilename();
  const destPath = join(targetDir, tempFilename);

  log.info('Starting download', { url: artifact.url, expectedSize: artifact.size, destPath });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(artifact.url, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }
    if (!response.body) {
      throw new Error('Response body is empty');
    }

    const contentLength = parseInt(response.headers.get('content-length') ?? '0', 10);
    const totalSize = contentLength > 0 ? contentLength : artifact.size;
    const chunks = await streamResponse(response.body, totalSize, onProgress);
    const merged = Buffer.concat(chunks);
    await Bun.write(destPath, merged);

    log.info('Download complete', { destPath, bytesReceived: merged.byteLength });
    return destPath;
  } finally {
    clearTimeout(timeout);
  }
}
