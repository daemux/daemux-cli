/**
 * Checksum Verification for Downloaded Artifacts
 * Uses Bun.CryptoHasher with SHA-256 to verify file integrity
 */

import { getLogger } from './logger';

const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;

// ---------------------------------------------------------------------------
// File Checksum Computation
// ---------------------------------------------------------------------------

async function computeSha256(filePath: string): Promise<string> {
  const file = Bun.file(filePath);
  const stream = file.stream();
  const hasher = new Bun.CryptoHasher('sha256');

  for await (const chunk of stream) {
    hasher.update(chunk);
  }

  return hasher.digest('hex');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function verifyChecksum(
  filePath: string,
  expectedHash: string
): Promise<{ valid: boolean; actual: string }> {
  const log = getLogger().child('updater:verifier');

  if (!SHA256_HEX_REGEX.test(expectedHash)) {
    log.error('Invalid SHA-256 hash format', {
      expectedHash,
      length: expectedHash.length,
    });
    return { valid: false, actual: '' };
  }

  const file = Bun.file(filePath);
  const exists = await file.exists();
  if (!exists) {
    log.error('File not found for checksum verification', { filePath });
    return { valid: false, actual: '' };
  }

  const actual = await computeSha256(filePath);
  const valid = actual.toLowerCase() === expectedHash.toLowerCase();

  if (!valid) {
    log.warn('Checksum mismatch', {
      filePath,
      expected: expectedHash.toLowerCase(),
      actual: actual.toLowerCase(),
    });
  } else {
    log.debug('Checksum verified', { filePath });
  }

  return { valid, actual };
}
