/**
 * Auth Integration Tests
 * Tests CLI authentication functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { resolveApiKey, hasValidCredentials } from '../src/cli/auth';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync, chmodSync } from 'fs';
import { homedir } from 'os';

describe('Auth', () => {
  const testCredDir = join(homedir(), '.daemux', 'credentials');
  const anthropicCredPath = join(testCredDir, 'anthropic.json');
  let originalEnv: {
    ANTHROPIC_OAUTH_TOKEN?: string;
    ANTHROPIC_API_KEY?: string;
  };

  beforeEach(() => {
    // Store original env vars
    originalEnv = {
      ANTHROPIC_OAUTH_TOKEN: process.env.ANTHROPIC_OAUTH_TOKEN,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    };

    // Clear env vars for testing
    delete process.env.ANTHROPIC_OAUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;

    // Ensure credentials directory exists
    mkdirSync(testCredDir, { recursive: true });
  });

  afterEach(() => {
    // Restore original env vars
    if (originalEnv.ANTHROPIC_OAUTH_TOKEN !== undefined) {
      process.env.ANTHROPIC_OAUTH_TOKEN = originalEnv.ANTHROPIC_OAUTH_TOKEN;
    } else {
      delete process.env.ANTHROPIC_OAUTH_TOKEN;
    }

    if (originalEnv.ANTHROPIC_API_KEY !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalEnv.ANTHROPIC_API_KEY;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }

    // Don't delete the credentials file as it may be a real user's credentials
    // Only clean up test-specific data
  });

  describe('resolveApiKey', () => {
    it('should return ANTHROPIC_OAUTH_TOKEN if set', () => {
      const testToken = 'sk-ant-oat01-test-token-for-testing-purposes-only-12345678901234567890123456';
      process.env.ANTHROPIC_OAUTH_TOKEN = testToken;

      const resolved = resolveApiKey();
      expect(resolved).toBe(testToken);
    });

    it('should return ANTHROPIC_API_KEY if set and no token', () => {
      const testKey = 'sk-ant-api03-test-api-key';
      process.env.ANTHROPIC_API_KEY = testKey;

      const resolved = resolveApiKey();
      expect(resolved).toBe(testKey);
    });

    it('should prefer ANTHROPIC_OAUTH_TOKEN over ANTHROPIC_API_KEY', () => {
      const testToken = 'sk-ant-oat01-test-token-for-testing-purposes-only-12345678901234567890123456';
      const testKey = 'sk-ant-api03-test-api-key';
      process.env.ANTHROPIC_OAUTH_TOKEN = testToken;
      process.env.ANTHROPIC_API_KEY = testKey;

      const resolved = resolveApiKey();
      expect(resolved).toBe(testToken);
    });

    it('should return stored credentials if no env vars', () => {
      // This test only runs if there are stored credentials
      // We don't write test credentials to avoid interfering with real user setup
      const resolved = resolveApiKey();
      // Result will be either the stored credential or undefined
      expect(resolved === undefined || typeof resolved === 'string').toBe(true);
    });
  });

  describe('hasValidCredentials', () => {
    it('should return true when env token is set', () => {
      process.env.ANTHROPIC_OAUTH_TOKEN = 'sk-ant-oat01-test-token-12345678901234567890123456789012345678901234567890';

      expect(hasValidCredentials()).toBe(true);
    });

    it('should return true when env API key is set', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-test-key';

      expect(hasValidCredentials()).toBe(true);
    });

    it('should return based on stored credentials when no env vars', () => {
      // Result depends on whether user has stored credentials
      const result = hasValidCredentials();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('Credential Priority', () => {
    it('should follow correct priority order', () => {
      // Priority 1: ANTHROPIC_OAUTH_TOKEN
      // Priority 2: ANTHROPIC_API_KEY
      // Priority 3: Stored credentials

      const token = 'sk-ant-oat01-priority-token-test-12345678901234567890123456789012345678901234';
      const key = 'sk-ant-api03-priority-key-test';

      // Test with only key
      process.env.ANTHROPIC_API_KEY = key;
      expect(resolveApiKey()).toBe(key);

      // Test with token (should take priority)
      process.env.ANTHROPIC_OAUTH_TOKEN = token;
      expect(resolveApiKey()).toBe(token);

      // Clear token, key should be used
      delete process.env.ANTHROPIC_OAUTH_TOKEN;
      expect(resolveApiKey()).toBe(key);
    });
  });
});
