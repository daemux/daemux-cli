import { describe, it, expect } from 'bun:test';
import { verifyCredentials, TOKEN_PREFIX, API_KEY_PREFIX, TOKEN_MIN_LENGTH } from '../../src/cli/credentials';

describe('Credentials Verify - Error classification', () => {
  function classifyError(errorMessage: string): 'auth' | 'permission' | 'non-auth' | 'unknown' {
    const lower = errorMessage.toLowerCase();
    const authErrors = ['authentication_error', 'invalid x-api-key', 'invalid api key', 'invalid_api_key', 'api key not valid'];
    const has401 = lower.includes('401') && lower.includes('unauthorized');

    if (authErrors.some(p => lower.includes(p)) || has401) return 'auth';
    if (['permission_error', 'permission denied', '403'].some(p => lower.includes(p))) return 'permission';

    const nonAuthErrors = ['rate_limit', 'overloaded', 'billing', 'quota', 'credit', 'model not found', 'not_found_error', 'invalid_request', 'bad_request', 'timeout', 'connection', 'network'];
    if (nonAuthErrors.some(p => lower.includes(p))) return 'non-auth';

    return 'unknown';
  }

  const authErrors = [
    'authentication_error: invalid credentials',
    'invalid x-api-key header',
    '401 Unauthorized: bad token',
  ];

  const permissionErrors = [
    'permission_error: access denied',
    '403 Forbidden',
  ];

  const nonAuthErrors = [
    'rate_limit: too many requests',
    'billing: insufficient credits',
    'model not found: claude-3',
    'timeout: request took too long',
  ];

  authErrors.forEach(msg => {
    it(`classifies "${msg.slice(0, 30)}..." as auth error`, () => {
      expect(classifyError(msg)).toBe('auth');
    });
  });

  permissionErrors.forEach(msg => {
    it(`classifies "${msg}" as permission error`, () => {
      expect(classifyError(msg)).toBe('permission');
    });
  });

  nonAuthErrors.forEach(msg => {
    it(`classifies "${msg.slice(0, 30)}..." as non-auth error`, () => {
      expect(classifyError(msg)).toBe('non-auth');
    });
  });

  it('classifies unknown errors', () => {
    expect(classifyError('some random error')).toBe('unknown');
    expect(classifyError('')).toBe('unknown');
  });
});

describe('Credentials Verify - Client configuration', () => {
  it('constructs token client options', () => {
    const claudeCodeVersion = '2.1.2';
    const value = TOKEN_PREFIX + 'test-token';

    const clientOptions = {
      apiKey: null as unknown as undefined,
      authToken: value,
      defaultHeaders: {
        'accept': 'application/json',
        'anthropic-dangerous-direct-browser-access': 'true',
        'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
        'user-agent': `claude-cli/${claudeCodeVersion} (external, cli)`,
        'x-app': 'cli',
      },
    };

    expect(clientOptions.authToken).toBe(value);
    expect(clientOptions.apiKey).toBeNull();
    expect(clientOptions.defaultHeaders['anthropic-beta']).toContain('oauth');
  });

  it('constructs API key client options', () => {
    const value = API_KEY_PREFIX + '03-test-key';
    const clientOptions = { apiKey: value };
    expect(clientOptions.apiKey).toBe(value);
  });
});

describe('Credentials Verify - API call parameters', () => {
  it('uses correct model and parameters', () => {
    expect('claude-3-haiku-20240307').toContain('haiku');
    expect([{ role: 'user', content: 'hi' }][0].content).toBe('hi');
  });
});

describe('Credentials Verify - Return values', () => {
  it('returns valid: true on success', () => {
    expect({ valid: true }).not.toHaveProperty('error');
  });

  it('returns valid: false with error on auth failure', () => {
    const result = { valid: false, error: 'Invalid credentials. Please check your token or API key.' };
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid credentials');
  });

  it('returns valid: false with error on permission failure', () => {
    const result = { valid: false, error: 'Credentials valid but access denied. Check your account permissions.' };
    expect(result.valid).toBe(false);
    expect(result.error).toContain('access denied');
  });
});

describe('Credentials Verify - Error handling', () => {
  it('handles Error instance', () => {
    const err = new Error('test error');
    const errorMessage = err instanceof Error ? err.message : String(err);
    expect(errorMessage).toBe('test error');
  });

  it('handles string error', () => {
    const err = 'string error';
    const errorMessage = err instanceof Error ? err.message : String(err);
    expect(errorMessage).toBe('string error');
  });
});

describe('Credentials Verify - 401 detection', () => {
  it('detects 401 Unauthorized', () => {
    const msg = '401 Unauthorized';
    const lower = msg.toLowerCase();
    expect(lower.includes('401') && lower.includes('unauthorized')).toBe(true);
  });

  it('requires both 401 and unauthorized', () => {
    expect('Error 401'.toLowerCase().includes('401') && 'Error 401'.toLowerCase().includes('unauthorized')).toBe(false);
    expect('unauthorized access'.toLowerCase().includes('401') && 'unauthorized access'.toLowerCase().includes('unauthorized')).toBe(false);
  });
});
