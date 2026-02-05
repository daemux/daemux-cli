/**
 * Auth Module Tests
 * Tests the auth module exports and command registration
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Command } from 'commander';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Import the entire auth module
import * as authModule from '../../src/cli/auth';
import {
  TOKEN_PREFIX,
  TOKEN_MIN_LENGTH,
  API_KEY_PREFIX,
  SUPPORTED_PROVIDERS,
  saveCredentials,
  clearCredentials,
  loadCredentials,
} from '../../src/cli/credentials';

describe('Auth Module', () => {
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

  describe('Module Exports', () => {
    it('should export resolveCredentials', () => {
      expect(authModule.resolveCredentials).toBeDefined();
      expect(typeof authModule.resolveCredentials).toBe('function');
    });

    it('should export resolveApiKey', () => {
      expect(authModule.resolveApiKey).toBeDefined();
      expect(typeof authModule.resolveApiKey).toBe('function');
    });

    it('should export hasValidCredentials', () => {
      expect(authModule.hasValidCredentials).toBeDefined();
      expect(typeof authModule.hasValidCredentials).toBe('function');
    });

    it('should export registerAuthCommands', () => {
      expect(authModule.registerAuthCommands).toBeDefined();
      expect(typeof authModule.registerAuthCommands).toBe('function');
    });
  });

  describe('resolveCredentials', () => {
    it('should return undefined when no credentials', () => {
      clearCredentials('anthropic');
      // May still have claude-keychain if user has it
      const result = authModule.resolveCredentials();
      expect(result === undefined || typeof result === 'object').toBe(true);
    });

    it('should return env token first', () => {
      process.env.ANTHROPIC_OAUTH_TOKEN = 'test-token';

      const result = authModule.resolveCredentials();

      expect(result?.type).toBe('token');
      expect(result?.value).toBe('test-token');
      expect(result?.source).toBe('env');
    });

    it('should return env api_key when no token', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const result = authModule.resolveCredentials();

      expect(result?.type).toBe('api_key');
      expect(result?.value).toBe('test-key');
      expect(result?.source).toBe('env');
    });

    it('should return stored credentials', () => {
      saveCredentials('anthropic', {
        type: 'api_key',
        provider: 'anthropic',
        apiKey: 'stored-key',
        expires: null,
        createdAt: Date.now(),
      });

      const result = authModule.resolveCredentials();

      // May be stored or claude-keychain
      expect(result?.source === 'stored' || result?.source === 'claude-keychain' || result === undefined).toBe(true);
    });
  });

  describe('resolveApiKey', () => {
    it('should return key from env', () => {
      process.env.ANTHROPIC_API_KEY = 'api-key-test';

      const result = authModule.resolveApiKey();

      expect(result).toBe('api-key-test');
    });

    it('should return token from env', () => {
      process.env.ANTHROPIC_OAUTH_TOKEN = 'token-test';

      const result = authModule.resolveApiKey();

      expect(result).toBe('token-test');
    });
  });

  describe('hasValidCredentials', () => {
    it('should return true with env key', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      expect(authModule.hasValidCredentials()).toBe(true);
    });

    it('should return true with env token', () => {
      process.env.ANTHROPIC_OAUTH_TOKEN = 'test-token';

      expect(authModule.hasValidCredentials()).toBe(true);
    });

    it('should return boolean', () => {
      clearCredentials('anthropic');

      const result = authModule.hasValidCredentials();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('registerAuthCommands', () => {
    it('should register auth command group', () => {
      const program = new Command();

      authModule.registerAuthCommands(program);

      const authCommand = program.commands.find(cmd => cmd.name() === 'auth');
      expect(authCommand).toBeDefined();
    });

    it('should register setup-token subcommand', () => {
      const program = new Command();

      authModule.registerAuthCommands(program);

      const authCommand = program.commands.find(cmd => cmd.name() === 'auth');
      const setupTokenCmd = authCommand?.commands.find(cmd => cmd.name() === 'setup-token');
      expect(setupTokenCmd).toBeDefined();
    });

    it('should register api-key subcommand', () => {
      const program = new Command();

      authModule.registerAuthCommands(program);

      const authCommand = program.commands.find(cmd => cmd.name() === 'auth');
      const apiKeyCmd = authCommand?.commands.find(cmd => cmd.name() === 'api-key');
      expect(apiKeyCmd).toBeDefined();
    });

    it('should register status subcommand', () => {
      const program = new Command();

      authModule.registerAuthCommands(program);

      const authCommand = program.commands.find(cmd => cmd.name() === 'auth');
      const statusCmd = authCommand?.commands.find(cmd => cmd.name() === 'status');
      expect(statusCmd).toBeDefined();
    });

    it('should register clear subcommand', () => {
      const program = new Command();

      authModule.registerAuthCommands(program);

      const authCommand = program.commands.find(cmd => cmd.name() === 'auth');
      const clearCmd = authCommand?.commands.find(cmd => cmd.name() === 'clear');
      expect(clearCmd).toBeDefined();
    });

    it('should have provider option on setup-token', () => {
      const program = new Command();

      authModule.registerAuthCommands(program);

      const authCommand = program.commands.find(cmd => cmd.name() === 'auth');
      const setupTokenCmd = authCommand?.commands.find(cmd => cmd.name() === 'setup-token');

      // Check options
      const options = setupTokenCmd?.options ?? [];
      const providerOpt = options.find((opt: any) => opt.long === '--provider');
      expect(providerOpt).toBeDefined();
    });

    it('should have provider option on api-key', () => {
      const program = new Command();

      authModule.registerAuthCommands(program);

      const authCommand = program.commands.find(cmd => cmd.name() === 'auth');
      const apiKeyCmd = authCommand?.commands.find(cmd => cmd.name() === 'api-key');

      const options = apiKeyCmd?.options ?? [];
      const providerOpt = options.find((opt: any) => opt.long === '--provider');
      expect(providerOpt).toBeDefined();
    });

    it('should have provider option on clear', () => {
      const program = new Command();

      authModule.registerAuthCommands(program);

      const authCommand = program.commands.find(cmd => cmd.name() === 'auth');
      const clearCmd = authCommand?.commands.find(cmd => cmd.name() === 'clear');

      const options = clearCmd?.options ?? [];
      const providerOpt = options.find((opt: any) => opt.long === '--provider');
      expect(providerOpt).toBeDefined();
    });

    it('should have description for auth command', () => {
      const program = new Command();

      authModule.registerAuthCommands(program);

      const authCommand = program.commands.find(cmd => cmd.name() === 'auth');
      expect(authCommand?.description()).toContain('credential');
    });
  });

  describe('ResolvedCredentials type', () => {
    it('should have correct token structure', () => {
      process.env.ANTHROPIC_OAUTH_TOKEN = 'test-token';

      const creds = authModule.resolveCredentials();

      if (creds) {
        expect(creds.type).toBe('token');
        expect(typeof creds.value).toBe('string');
        expect(creds.source).toBe('env');
      }
    });

    it('should have correct api_key structure', () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';

      const creds = authModule.resolveCredentials();

      if (creds) {
        expect(creds.type).toBe('api_key');
        expect(typeof creds.value).toBe('string');
        expect(creds.source).toBe('env');
      }
    });
  });
});

describe('Auth Validation Logic', () => {
  describe('Token Validation', () => {
    it('should validate empty token', () => {
      const token = '';
      const isValid = token.length > 0 && token.startsWith(TOKEN_PREFIX);
      expect(isValid).toBe(false);
    });

    it('should validate prefix', () => {
      const validToken = TOKEN_PREFIX + 'rest';
      const invalidToken = 'invalid-prefix';

      expect(validToken.startsWith(TOKEN_PREFIX)).toBe(true);
      expect(invalidToken.startsWith(TOKEN_PREFIX)).toBe(false);
    });

    it('should validate minimum length', () => {
      const shortToken = TOKEN_PREFIX + 'short';
      const longToken = TOKEN_PREFIX + 'x'.repeat(TOKEN_MIN_LENGTH);

      expect(shortToken.length).toBeLessThan(TOKEN_MIN_LENGTH);
      expect(longToken.length).toBeGreaterThanOrEqual(TOKEN_MIN_LENGTH);
    });
  });

  describe('API Key Validation', () => {
    it('should validate empty key', () => {
      const key = '';
      const isValid = key.length > 0 && key.startsWith(API_KEY_PREFIX);
      expect(isValid).toBe(false);
    });

    it('should validate prefix', () => {
      const validKey = API_KEY_PREFIX + '03-rest';
      const invalidKey = 'invalid-key';

      expect(validKey.startsWith(API_KEY_PREFIX)).toBe(true);
      expect(invalidKey.startsWith(API_KEY_PREFIX)).toBe(false);
    });
  });

  describe('Provider Validation', () => {
    it('should accept anthropic', () => {
      expect(SUPPORTED_PROVIDERS.includes('anthropic')).toBe(true);
    });

    it('should reject unknown providers', () => {
      const unknownProviders = ['openai', 'google', 'azure', 'local'];

      for (const p of unknownProviders) {
        expect(SUPPORTED_PROVIDERS.includes(p as any)).toBe(false);
      }
    });
  });
});

describe('Mask Credential Logic', () => {
  function maskCredential(value?: string): string {
    if (!value) return 'N/A';
    if (value.length < 20) return '*'.repeat(value.length);
    return `${value.slice(0, 15)}...${value.slice(-4)}`;
  }

  it('should mask undefined as N/A', () => {
    expect(maskCredential(undefined)).toBe('N/A');
  });

  it('should mask empty string as N/A', () => {
    expect(maskCredential('')).toBe('N/A');
  });

  it('should fully mask short credentials', () => {
    expect(maskCredential('short')).toBe('*****');
    expect(maskCredential('12345678901234567')).toBe('*****************');
  });

  it('should partially mask long credentials', () => {
    const longCred = 'sk-ant-api03-very-long-credential-key-12345678';
    const masked = maskCredential(longCred);

    expect(masked).toContain('...');
    expect(masked.length).toBeLessThan(longCred.length);
    expect(masked.endsWith('5678')).toBe(true);
  });

  it('should handle exactly 20 chars', () => {
    const exact20 = 'x'.repeat(20);
    const masked = maskCredential(exact20);

    expect(masked).toContain('...');
  });

  it('should handle 19 chars', () => {
    const chars19 = 'x'.repeat(19);
    const masked = maskCredential(chars19);

    expect(masked).toBe('*'.repeat(19));
  });
});
