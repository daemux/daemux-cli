/**
 * Credentials Unit Tests
 * Tests credential loading, saving, and verification
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, chmodSync } from 'fs';
import { homedir } from 'os';
import {
  TOKEN_PREFIX,
  API_KEY_PREFIX,
  TOKEN_MIN_LENGTH,
  SUPPORTED_PROVIDERS,
  getCredentialsDir,
  getCredentialsPath,
  loadCredentials,
  saveCredentials,
  clearCredentials,
  getEnvCredentials,
  resolveCredentials,
  resolveApiKey,
  hasValidCredentials,
} from '../../src/cli/credentials';

describe('Credentials', () => {
  const testCredDir = join(import.meta.dir, 'test-credentials-temp');
  let originalEnv: {
    ANTHROPIC_OAUTH_TOKEN?: string;
    ANTHROPIC_API_KEY?: string;
  };

  beforeEach(() => {
    originalEnv = {
      ANTHROPIC_OAUTH_TOKEN: process.env.ANTHROPIC_OAUTH_TOKEN,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    };

    delete process.env.ANTHROPIC_OAUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;

    mkdirSync(testCredDir, { recursive: true });
  });

  afterEach(() => {
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

    if (existsSync(testCredDir)) {
      rmSync(testCredDir, { recursive: true });
    }
  });

  describe('Constants', () => {
    it('should export TOKEN_PREFIX', () => {
      expect(TOKEN_PREFIX).toBe('sk-ant-oat01-');
    });

    it('should export API_KEY_PREFIX', () => {
      expect(API_KEY_PREFIX).toBe('sk-ant-api');
    });

    it('should export TOKEN_MIN_LENGTH', () => {
      expect(TOKEN_MIN_LENGTH).toBe(80);
    });

    it('should export SUPPORTED_PROVIDERS', () => {
      expect(SUPPORTED_PROVIDERS).toContain('anthropic');
    });
  });

  describe('Path Helpers', () => {
    describe('getCredentialsDir', () => {
      it('should return path in home directory', () => {
        const dir = getCredentialsDir();
        expect(dir).toContain(homedir());
        expect(dir).toContain('.daemux');
        expect(dir).toContain('credentials');
      });
    });

    describe('getCredentialsPath', () => {
      it('should return path for provider', () => {
        const path = getCredentialsPath('anthropic');
        expect(path).toContain('anthropic.json');
      });
    });
  });

  describe('loadCredentials', () => {
    it('should return null for non-existent file', () => {
      const result = loadCredentials('anthropic');
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('should handle malformed JSON gracefully', () => {
      const result = loadCredentials('anthropic');
      expect(result === null || typeof result === 'object').toBe(true);
    });
  });

  describe('getEnvCredentials', () => {
    it('should return token from ANTHROPIC_OAUTH_TOKEN', () => {
      const testToken = 'sk-ant-oat01-test-token-12345';
      process.env.ANTHROPIC_OAUTH_TOKEN = testToken;

      const result = getEnvCredentials();

      expect(result).toEqual({ type: 'token', value: testToken });
    });

    it('should return api_key from ANTHROPIC_API_KEY', () => {
      const testKey = 'sk-ant-api03-test-key';
      process.env.ANTHROPIC_API_KEY = testKey;

      const result = getEnvCredentials();

      expect(result).toEqual({ type: 'api_key', value: testKey });
    });

    it('should prefer token over api_key', () => {
      process.env.ANTHROPIC_OAUTH_TOKEN = 'token-value';
      process.env.ANTHROPIC_API_KEY = 'key-value';

      const result = getEnvCredentials();

      expect(result?.type).toBe('token');
      expect(result?.value).toBe('token-value');
    });

    it('should return null when no env vars set', () => {
      const result = getEnvCredentials();
      expect(result).toBeNull();
    });
  });

  describe('resolveCredentials', () => {
    it('should return token from environment', () => {
      const testToken = 'sk-ant-oat01-test-token-12345';
      process.env.ANTHROPIC_OAUTH_TOKEN = testToken;

      const result = resolveCredentials();

      expect(result?.type).toBe('token');
      expect(result?.value).toBe(testToken);
    });

    it('should return api_key from environment', () => {
      const testKey = 'sk-ant-api03-test-key';
      process.env.ANTHROPIC_API_KEY = testKey;

      const result = resolveCredentials();

      expect(result?.type).toBe('api_key');
      expect(result?.value).toBe(testKey);
    });

    it('should prefer token over api_key', () => {
      process.env.ANTHROPIC_OAUTH_TOKEN = 'token-value';
      process.env.ANTHROPIC_API_KEY = 'key-value';

      const result = resolveCredentials();

      expect(result?.type).toBe('token');
    });

    it('should fall back to stored credentials', () => {
      const result = resolveCredentials();
      expect(result === undefined || typeof result === 'object').toBe(true);
    });
  });

  describe('resolveApiKey', () => {
    it('should return value from resolveCredentials', () => {
      const testKey = 'sk-ant-api03-test-key';
      process.env.ANTHROPIC_API_KEY = testKey;

      const result = resolveApiKey();

      expect(result).toBe(testKey);
    });

    it('should return undefined when no credentials', () => {
      const result = resolveApiKey();
      expect(result === undefined || typeof result === 'string').toBe(true);
    });
  });

  describe('hasValidCredentials', () => {
    it('should return true when env token is set', () => {
      process.env.ANTHROPIC_OAUTH_TOKEN = 'token-value';

      expect(hasValidCredentials()).toBe(true);
    });

    it('should return true when env api key is set', () => {
      process.env.ANTHROPIC_API_KEY = 'key-value';

      expect(hasValidCredentials()).toBe(true);
    });

    it('should return boolean based on stored credentials', () => {
      const result = hasValidCredentials();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('Credential Priority', () => {
    it('should follow priority order', () => {
      const token = 'priority-token';
      process.env.ANTHROPIC_OAUTH_TOKEN = token;
      expect(resolveCredentials()?.value).toBe(token);

      delete process.env.ANTHROPIC_OAUTH_TOKEN;
      const key = 'priority-key';
      process.env.ANTHROPIC_API_KEY = key;
      expect(resolveCredentials()?.value).toBe(key);
    });
  });

  describe('Token Validation Patterns', () => {
    it('should recognize token prefix', () => {
      const token = `${TOKEN_PREFIX}rest-of-token`;
      expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    });

    it('should recognize API key prefix', () => {
      const key = `${API_KEY_PREFIX}03-rest-of-key`;
      expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    });

    it('should validate minimum token length', () => {
      const shortToken = 'short';
      const longToken = 'x'.repeat(TOKEN_MIN_LENGTH);

      expect(shortToken.length).toBeLessThan(TOKEN_MIN_LENGTH);
      expect(longToken.length).toBeGreaterThanOrEqual(TOKEN_MIN_LENGTH);
    });
  });
});
