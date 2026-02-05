import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Command } from 'commander';
import { mkdirSync, existsSync } from 'fs';
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
  getEnvCredentials,
} from '../../src/cli/credentials';

function validateCredential(
  value: string,
  type: 'token' | 'api_key'
): { valid: boolean; error?: string } {
  const label = type === 'token' ? 'Token' : 'API key';
  if (!value) return { valid: false, error: `${label} cannot be empty` };

  const prefix = type === 'token' ? TOKEN_PREFIX : API_KEY_PREFIX;
  if (!value.startsWith(prefix)) return { valid: false, error: `Must start with "${prefix}"` };

  if (type === 'token' && value.length < TOKEN_MIN_LENGTH) {
    return { valid: false, error: `Token must be at least ${TOKEN_MIN_LENGTH} characters` };
  }

  return { valid: true };
}

function validateProvider(provider: string): boolean {
  return SUPPORTED_PROVIDERS.includes(provider as any);
}

function maskCredential(value?: string): string {
  if (!value) return 'N/A';
  if (value.length < 20) return '*'.repeat(value.length);
  return `${value.slice(0, 15)}...${value.slice(-4)}`;
}

describe('Auth Integration - Validation Functions', () => {
  describe('validateCredential', () => {
    const validToken = TOKEN_PREFIX + 'x'.repeat(TOKEN_MIN_LENGTH - TOKEN_PREFIX.length);
    const validKey = API_KEY_PREFIX + '03-valid-key-content';

    it('validates empty values', () => {
      expect(validateCredential('', 'token').valid).toBe(false);
      expect(validateCredential('', 'api_key').valid).toBe(false);
    });

    it('validates prefix requirement', () => {
      expect(validateCredential('invalid', 'token').valid).toBe(false);
      expect(validateCredential('invalid', 'api_key').valid).toBe(false);
    });

    it('validates token minimum length', () => {
      const shortToken = TOKEN_PREFIX + 'short';
      expect(validateCredential(shortToken, 'token').valid).toBe(false);
    });

    it('accepts valid credentials', () => {
      expect(validateCredential(validToken, 'token').valid).toBe(true);
      expect(validateCredential(validKey, 'api_key').valid).toBe(true);
    });

    it('uses correct labels', () => {
      expect(validateCredential('', 'token').error).toContain('Token');
      expect(validateCredential('', 'api_key').error).toContain('API key');
    });
  });

  describe('validateProvider', () => {
    it('accepts supported providers', () => {
      expect(validateProvider('anthropic')).toBe(true);
    });

    it('rejects unsupported providers', () => {
      expect(validateProvider('openai')).toBe(false);
      expect(validateProvider('')).toBe(false);
      expect(validateProvider('ANTHROPIC')).toBe(false);
    });
  });
});

describe('maskCredential', () => {
  it('masks empty values', () => {
    expect(maskCredential(undefined)).toBe('N/A');
    expect(maskCredential('')).toBe('N/A');
  });

  it('fully masks short credentials', () => {
    expect(maskCredential('short')).toBe('*****');
    expect(maskCredential('a')).toBe('*');
  });

  it('partially masks long credentials', () => {
    const cred = '12345678901234567890';
    expect(maskCredential(cred)).toBe('123456789012345...7890');
  });
});

describe('Credentials storage', () => {
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
      if (value !== undefined) process.env[key] = value;
      else delete process.env[key];
    });
    try { clearCredentials('anthropic'); } catch {}
  });

  it('saves and loads token credentials', () => {
    const testCreds = {
      type: 'token' as const,
      provider: 'anthropic',
      token: TOKEN_PREFIX + 'x'.repeat(TOKEN_MIN_LENGTH),
      expires: null,
      createdAt: Date.now(),
    };

    saveCredentials('anthropic', testCreds);
    const loaded = loadCredentials('anthropic');

    expect(loaded?.type).toBe('token');
    expect(loaded?.token).toBe(testCreds.token);
  });

  it('saves and loads API key credentials', () => {
    const testCreds = {
      type: 'api_key' as const,
      provider: 'anthropic',
      apiKey: API_KEY_PREFIX + '03-integration-test',
      expires: null,
      createdAt: Date.now(),
    };

    saveCredentials('anthropic', testCreds);
    const loaded = loadCredentials('anthropic');

    expect(loaded?.type).toBe('api_key');
    expect(loaded?.apiKey).toBe(testCreds.apiKey);
  });
});

describe('Environment credentials', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {
      ANTHROPIC_OAUTH_TOKEN: process.env.ANTHROPIC_OAUTH_TOKEN,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    };
  });

  afterEach(() => {
    Object.entries(originalEnv).forEach(([key, value]) => {
      if (value !== undefined) process.env[key] = value;
      else delete process.env[key];
    });
    try { clearCredentials('anthropic'); } catch {}
  });

  it('detects token from environment', () => {
    process.env.ANTHROPIC_OAUTH_TOKEN = 'test-env-token';
    const envCreds = getEnvCredentials();
    expect(envCreds?.type).toBe('token');
    expect(envCreds?.value).toBe('test-env-token');
  });

  it('detects API key from environment', () => {
    delete process.env.ANTHROPIC_OAUTH_TOKEN;
    process.env.ANTHROPIC_API_KEY = 'test-env-key';
    const envCreds = getEnvCredentials();
    expect(envCreds?.type).toBe('api_key');
  });

  it('returns null when no credentials set', () => {
    delete process.env.ANTHROPIC_OAUTH_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    expect(getEnvCredentials()).toBeNull();
  });

  it('prefers token over API key', () => {
    process.env.ANTHROPIC_OAUTH_TOKEN = 'token-value';
    process.env.ANTHROPIC_API_KEY = 'key-value';
    expect(getEnvCredentials()?.type).toBe('token');
  });
});

describe('Credentials clearing', () => {
  const testCredDir = join(homedir(), '.daemux', 'credentials');

  beforeEach(() => {
    mkdirSync(testCredDir, { recursive: true });
  });

  afterEach(() => {
    try { clearCredentials('anthropic'); } catch {}
  });

  it('returns true when clearing existing credentials', () => {
    saveCredentials('anthropic', {
      type: 'api_key',
      provider: 'anthropic',
      apiKey: 'test-key',
      expires: null,
      createdAt: Date.now(),
    });

    expect(clearCredentials('anthropic')).toBe(true);
  });

  it('returns false when no credentials exist', () => {
    clearCredentials('anthropic');
    expect(clearCredentials('anthropic')).toBe(false);
  });

  it('removes the credentials file', () => {
    saveCredentials('anthropic', {
      type: 'api_key',
      provider: 'anthropic',
      apiKey: 'test-key',
      expires: null,
      createdAt: Date.now(),
    });

    const path = getCredentialsPath('anthropic');
    expect(existsSync(path)).toBe(true);
    clearCredentials('anthropic');
    expect(existsSync(path)).toBe(false);
  });
});

describe('Command registration', () => {
  it('registers all auth subcommands', () => {
    const { registerAuthCommands } = require('../../src/cli/auth');
    const program = new Command();
    registerAuthCommands(program);

    const authCmd = program.commands.find(c => c.name() === 'auth');
    expect(authCmd).toBeDefined();

    const subcommands = authCmd?.commands.map(c => c.name()) ?? [];
    expect(subcommands).toContain('setup-token');
    expect(subcommands).toContain('api-key');
    expect(subcommands).toContain('status');
    expect(subcommands).toContain('clear');
  });

  it('includes provider options on relevant commands', () => {
    const { registerAuthCommands } = require('../../src/cli/auth');
    const program = new Command();
    registerAuthCommands(program);

    const authCmd = program.commands.find(c => c.name() === 'auth');
    const hasProviderOpt = (cmd: any) => cmd?.options?.some((o: any) => o.long === '--provider');

    expect(hasProviderOpt(authCmd?.commands.find(c => c.name() === 'setup-token'))).toBe(true);
    expect(hasProviderOpt(authCmd?.commands.find(c => c.name() === 'api-key'))).toBe(true);
    expect(hasProviderOpt(authCmd?.commands.find(c => c.name() === 'clear'))).toBe(true);
  });
});

describe('Error classification', () => {
  function classifyError(errorMessage: string): 'auth' | 'permission' | 'non-auth' | 'unknown' {
    const lower = errorMessage.toLowerCase();
    const authErrors = ['authentication_error', 'invalid x-api-key', 'invalid api key', 'invalid_api_key', 'api key not valid'];
    const has401 = lower.includes('401') && lower.includes('unauthorized');

    if (authErrors.some(err => lower.includes(err)) || has401) return 'auth';
    if (['permission_error', 'permission denied', '403'].some(err => lower.includes(err))) return 'permission';

    const nonAuthErrors = ['rate_limit', 'overloaded', 'billing', 'quota', 'credit', 'model not found', 'not_found_error', 'invalid_request', 'bad_request', 'timeout', 'connection', 'network'];
    if (nonAuthErrors.some(err => lower.includes(err))) return 'non-auth';

    return 'unknown';
  }

  it('classifies auth errors', () => {
    expect(classifyError('authentication_error: invalid credentials')).toBe('auth');
    expect(classifyError('invalid x-api-key header')).toBe('auth');
    expect(classifyError('401 Unauthorized: bad token')).toBe('auth');
  });

  it('classifies permission errors', () => {
    expect(classifyError('403 Forbidden')).toBe('permission');
    expect(classifyError('permission denied for resource')).toBe('permission');
  });

  it('classifies non-auth errors', () => {
    expect(classifyError('rate_limit exceeded')).toBe('non-auth');
    expect(classifyError('billing: insufficient credits')).toBe('non-auth');
    expect(classifyError('network connection failed')).toBe('non-auth');
    expect(classifyError('model not found: claude-3')).toBe('non-auth');
  });

  it('classifies unknown errors', () => {
    expect(classifyError('some random error')).toBe('unknown');
    expect(classifyError('')).toBe('unknown');
  });
});

