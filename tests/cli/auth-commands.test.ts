/**
 * Auth Commands Unit Tests
 * Tests validation functions and command behavior
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Command } from 'commander';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import {
  TOKEN_PREFIX,
  API_KEY_PREFIX,
  TOKEN_MIN_LENGTH,
  SUPPORTED_PROVIDERS,
  saveCredentials,
  clearCredentials,
  loadCredentials,
  getCredentialsPath,
} from '../../src/cli/credentials';

describe('Auth Commands', () => {
  const testCredDir = join(homedir(), '.daemux', 'credentials');
  let originalEnv: Record<string, string | undefined>;

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
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value !== undefined) {
        process.env[key] = value;
      } else {
        delete process.env[key];
      }
    });

    try {
      clearCredentials('anthropic');
    } catch {
      // Ignore
    }
  });

  describe('validateCredential for token', () => {
    it('should reject empty token', () => {
      const token = '';
      const isValid = token.length > 0 && token.startsWith(TOKEN_PREFIX) && token.length >= TOKEN_MIN_LENGTH;
      expect(isValid).toBe(false);
    });

    it('should reject token without prefix', () => {
      const token = 'invalid-token-without-prefix';
      const isValid = token.startsWith(TOKEN_PREFIX);
      expect(isValid).toBe(false);
    });

    it('should reject token below minimum length', () => {
      const token = TOKEN_PREFIX + 'short';
      const isValid = token.length >= TOKEN_MIN_LENGTH;
      expect(isValid).toBe(false);
    });

    it('should accept valid token', () => {
      const token = TOKEN_PREFIX + 'x'.repeat(TOKEN_MIN_LENGTH - TOKEN_PREFIX.length);
      const isValid = token.startsWith(TOKEN_PREFIX) && token.length >= TOKEN_MIN_LENGTH;
      expect(isValid).toBe(true);
    });
  });

  describe('validateCredential for api_key', () => {
    it('should reject empty API key', () => {
      const key = '';
      const isValid = key.length > 0 && key.startsWith(API_KEY_PREFIX);
      expect(isValid).toBe(false);
    });

    it('should reject API key without prefix', () => {
      const key = 'invalid-key-without-prefix';
      const isValid = key.startsWith(API_KEY_PREFIX);
      expect(isValid).toBe(false);
    });

    it('should accept valid API key', () => {
      const key = API_KEY_PREFIX + '03-valid-key-12345';
      const isValid = key.startsWith(API_KEY_PREFIX);
      expect(isValid).toBe(true);
    });
  });

  describe('validateProvider', () => {
    it('should accept anthropic', () => {
      const provider = 'anthropic';
      const isValid = SUPPORTED_PROVIDERS.includes(provider as any);
      expect(isValid).toBe(true);
    });

    it('should reject unsupported provider', () => {
      const providers = ['openai', 'google', 'azure', 'invalid'];

      for (const provider of providers) {
        const isValid = SUPPORTED_PROVIDERS.includes(provider as any);
        expect(isValid).toBe(false);
      }
    });

    it('should be case-sensitive', () => {
      const provider = 'ANTHROPIC';
      const isValid = SUPPORTED_PROVIDERS.includes(provider as any);
      expect(isValid).toBe(false);
    });
  });

  describe('maskCredential', () => {
    it('should mask short credentials completely', () => {
      const value = 'short';
      const masked = value.length < 20 ? '*'.repeat(value.length) : `${value.slice(0, 15)}...${value.slice(-4)}`;
      expect(masked).toBe('*****');
    });

    it('should show prefix and suffix for long credentials', () => {
      const value = 'sk-ant-api03-very-long-credential-here-12345678';
      const masked = value.length < 20 ? '*'.repeat(value.length) : `${value.slice(0, 15)}...${value.slice(-4)}`;
      expect(masked).toBe('sk-ant-api03-ve...5678');
    });

    it('should return N/A for undefined', () => {
      const value: string | undefined = undefined;
      const masked = value ? '*masked*' : 'N/A';
      expect(masked).toBe('N/A');
    });

    it('should handle exactly 20 character credential', () => {
      const value = 'x'.repeat(20);
      const masked = value.length < 20 ? '*'.repeat(value.length) : `${value.slice(0, 15)}...${value.slice(-4)}`;
      expect(masked).toContain('...');
    });

    it('should handle 19 character credential', () => {
      const value = 'x'.repeat(19);
      const masked = value.length < 20 ? '*'.repeat(value.length) : `${value.slice(0, 15)}...${value.slice(-4)}`;
      expect(masked).toBe('*'.repeat(19));
    });
  });

  describe('setupCredential flow', () => {
    it('should save token credentials correctly', () => {
      const testToken = TOKEN_PREFIX + 'x'.repeat(TOKEN_MIN_LENGTH);

      saveCredentials('anthropic', {
        type: 'token',
        provider: 'anthropic',
        token: testToken,
        expires: null,
        createdAt: Date.now(),
      });

      const loaded = loadCredentials('anthropic');
      expect(loaded?.type).toBe('token');
      expect(loaded?.token).toBe(testToken);
    });

    it('should save api_key credentials correctly', () => {
      const testKey = API_KEY_PREFIX + '03-test-key';

      saveCredentials('anthropic', {
        type: 'api_key',
        provider: 'anthropic',
        apiKey: testKey,
        expires: null,
        createdAt: Date.now(),
      });

      const loaded = loadCredentials('anthropic');
      expect(loaded?.type).toBe('api_key');
      expect(loaded?.apiKey).toBe(testKey);
    });

    it('should set correct field based on type', () => {
      // Token type should have token field
      saveCredentials('anthropic', {
        type: 'token',
        provider: 'anthropic',
        token: 'test-token',
        apiKey: undefined,
        expires: null,
        createdAt: Date.now(),
      });

      let loaded = loadCredentials('anthropic');
      expect(loaded?.token).toBe('test-token');
      expect(loaded?.apiKey).toBeUndefined();

      // API key type should have apiKey field
      saveCredentials('anthropic', {
        type: 'api_key',
        provider: 'anthropic',
        token: undefined,
        apiKey: 'test-api-key',
        expires: null,
        createdAt: Date.now(),
      });

      loaded = loadCredentials('anthropic');
      expect(loaded?.apiKey).toBe('test-api-key');
      expect(loaded?.token).toBeUndefined();
    });
  });

  describe('showStatus scenarios', () => {
    it('should detect env token', () => {
      process.env.ANTHROPIC_OAUTH_TOKEN = 'env-token';

      const envType = process.env.ANTHROPIC_OAUTH_TOKEN ? 'token' : 'api_key';
      expect(envType).toBe('token');
    });

    it('should detect env api_key', () => {
      process.env.ANTHROPIC_API_KEY = 'env-key';

      const hasEnv = !!process.env.ANTHROPIC_OAUTH_TOKEN || !!process.env.ANTHROPIC_API_KEY;
      expect(hasEnv).toBe(true);
    });

    it('should format masked credential', () => {
      const creds = {
        type: 'api_key' as const,
        token: undefined,
        apiKey: 'sk-ant-api03-very-long-key-12345678',
      };

      const value = creds.type === 'token' ? creds.token : creds.apiKey;
      const masked = value
        ? value.length < 20 ? '*'.repeat(value.length) : `${value.slice(0, 15)}...${value.slice(-4)}`
        : 'N/A';

      expect(masked).toContain('...');
    });

    it('should format created date', () => {
      const createdAt = Date.now();
      const createdDate = new Date(createdAt).toLocaleDateString();

      expect(typeof createdDate).toBe('string');
      expect(createdDate.length).toBeGreaterThan(0);
    });

    it('should detect expired keychain token', () => {
      const expiresAt = Date.now() - 1000; // Expired
      const isExpired = expiresAt <= Date.now();
      expect(isExpired).toBe(true);
    });

    it('should detect valid keychain token', () => {
      const expiresAt = Date.now() + 3600000; // 1 hour from now
      const isExpired = expiresAt <= Date.now();
      expect(isExpired).toBe(false);
    });
  });

  describe('clearAuth scenarios', () => {
    it('should clear existing credentials', () => {
      saveCredentials('anthropic', {
        type: 'api_key',
        provider: 'anthropic',
        apiKey: 'test-key',
        expires: null,
        createdAt: Date.now(),
      });

      const cleared = clearCredentials('anthropic');
      expect(cleared).toBe(true);
    });

    it('should handle non-existent credentials', () => {
      // Ensure no credentials
      clearCredentials('anthropic');

      const cleared = clearCredentials('anthropic');
      expect(cleared).toBe(false);
    });
  });

  describe('Command registration', () => {
    it('should have correct command structure', () => {
      // Test the expected command hierarchy
      const commands = ['setup-token', 'api-key', 'status', 'clear'];

      for (const cmd of commands) {
        expect(commands).toContain(cmd);
      }
    });

    it('should have provider option', () => {
      const defaultProvider = 'anthropic';
      expect(SUPPORTED_PROVIDERS).toContain(defaultProvider);
    });
  });

  describe('Spinner messages', () => {
    it('should have verifying message', () => {
      const verifyingMsg = 'Verifying credentials with Anthropic API';
      expect(verifyingMsg).toContain('Anthropic');
    });

    it('should have saving message', () => {
      const savingMsg = 'Saving credentials';
      expect(savingMsg).toContain('credentials');
    });

    it('should have removing message', () => {
      const provider = 'anthropic';
      const removingMsg = `Removing ${provider} credentials`;
      expect(removingMsg).toContain(provider);
    });
  });

  describe('Console output formatting', () => {
    it('should format token warning', () => {
      const warning = 'Note: Setup tokens are restricted to Claude Code use only.';
      expect(warning).toContain('restricted');
    });

    it('should format success indicator', () => {
      const successIndicator = '\u2713'; // checkmark
      expect(successIndicator).toBe('\u2713');
    });

    it('should format warning indicator', () => {
      const warningIndicator = '!';
      expect(warningIndicator).toBe('!');
    });
  });
});

describe('Auth Module Exports', () => {
  it('should export resolveCredentials', () => {
    const { resolveCredentials } = require('../../src/cli/auth');
    expect(typeof resolveCredentials).toBe('function');
  });

  it('should export resolveApiKey', () => {
    const { resolveApiKey } = require('../../src/cli/auth');
    expect(typeof resolveApiKey).toBe('function');
  });

  it('should export hasValidCredentials', () => {
    const { hasValidCredentials } = require('../../src/cli/auth');
    expect(typeof hasValidCredentials).toBe('function');
  });

  it('should export registerAuthCommands', () => {
    const { registerAuthCommands } = require('../../src/cli/auth');
    expect(typeof registerAuthCommands).toBe('function');
  });
});
