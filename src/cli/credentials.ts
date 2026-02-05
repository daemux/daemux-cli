/**
 * Credential Operations
 * Load, save, and clear credentials for authentication providers
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TOKEN_PREFIX = 'sk-ant-oat01-';
export const API_KEY_PREFIX = 'sk-ant-api';
export const TOKEN_MIN_LENGTH = 80;
export const SUPPORTED_PROVIDERS = ['anthropic'] as const;

export type Provider = (typeof SUPPORTED_PROVIDERS)[number];

// ---------------------------------------------------------------------------
// Credentials Schema
// ---------------------------------------------------------------------------

export interface Credentials {
  type: 'token' | 'api_key';
  provider: string;
  token?: string;
  apiKey?: string;
  expires?: number | null;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Path Helpers
// ---------------------------------------------------------------------------

export const getCredentialsDir = () => join(homedir(), '.daemux', 'credentials');
export const getCredentialsPath = (provider: Provider) => join(getCredentialsDir(), `${provider}.json`);

function ensureCredentialsDir(): void {
  const dir = getCredentialsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

// ---------------------------------------------------------------------------
// Credential Operations
// ---------------------------------------------------------------------------

export function loadCredentials(provider: Provider): Credentials | null {
  const path = getCredentialsPath(provider);
  if (!existsSync(path)) {
    return null;
  }

  try {
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content) as Credentials;
  } catch {
    return null;
  }
}

export function saveCredentials(provider: Provider, credentials: Credentials): void {
  ensureCredentialsDir();
  const path = getCredentialsPath(provider);
  writeFileSync(path, JSON.stringify(credentials, null, 2), { mode: 0o600 });

  // Ensure file permissions are correct
  try {
    chmodSync(path, 0o600);
  } catch {
    // Ignore chmod errors on Windows
  }
}

export function clearCredentials(provider: Provider): boolean {
  const path = getCredentialsPath(provider);
  if (!existsSync(path)) {
    return false;
  }

  rmSync(path);
  return true;
}

// ---------------------------------------------------------------------------
// Environment Variable Check
// ---------------------------------------------------------------------------

export function getEnvCredentials(): { type: 'token' | 'api_key'; value: string } | null {
  const token = process.env.ANTHROPIC_OAUTH_TOKEN;
  if (token) return { type: 'token', value: token };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) return { type: 'api_key', value: apiKey };

  return null;
}

// ---------------------------------------------------------------------------
// Token Verification
// ---------------------------------------------------------------------------

export async function verifyCredentials(
  value: string,
  type: 'token' | 'api_key'
): Promise<{ valid: boolean; error?: string }> {
  try {
    // For OAuth tokens, must mimic Claude Code's headers exactly
    // See: https://github.com/anthropics/pi-ai anthropic.js
    const claudeCodeVersion = '2.1.2';
    const clientOptions = type === 'token'
      ? {
          apiKey: null as unknown as undefined,
          authToken: value,
          defaultHeaders: {
            'accept': 'application/json',
            'anthropic-dangerous-direct-browser-access': 'true',
            'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
            'user-agent': `claude-cli/${claudeCodeVersion} (external, cli)`,
            'x-app': 'cli',
          }
        }
      : { apiKey: value };

    const client = new Anthropic(clientOptions);
    await client.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    });

    return { valid: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const lowerMessage = errorMessage.toLowerCase();

    const authErrors = ['authentication_error', 'invalid x-api-key', 'invalid api key', 'invalid_api_key', 'api key not valid'];
    const has401 = lowerMessage.includes('401') && lowerMessage.includes('unauthorized');
    if (authErrors.some(err => lowerMessage.includes(err)) || has401) {
      return { valid: false, error: 'Invalid credentials. Please check your token or API key.' };
    }

    if (['permission_error', 'permission denied', '403'].some(err => lowerMessage.includes(err))) {
      return { valid: false, error: 'Credentials valid but access denied. Check your account permissions.' };
    }

    const nonAuthErrors = ['rate_limit', 'overloaded', 'billing', 'quota', 'credit', 'model not found', 'not_found_error', 'invalid_request', 'bad_request', 'timeout', 'connection', 'network'];
    if (nonAuthErrors.some(err => lowerMessage.includes(err))) {
      return { valid: true };
    }

    console.warn('Warning: Could not fully verify credentials, saving anyway.');
    return { valid: true };
  }
}

// ---------------------------------------------------------------------------
// Claude Code Keychain Integration (macOS)
// ---------------------------------------------------------------------------

const CLAUDE_CLI_KEYCHAIN_SERVICE = 'Claude Code-credentials';

interface ClaudeOAuthCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

/**
 * Read OAuth credentials from Claude Code's keychain (macOS only).
 * This provides access to the actual OAuth tokens that work for general API use,
 * unlike setup tokens which are restricted to Claude Code.
 */
export function readClaudeCliCredentials(): ClaudeOAuthCredentials | null {
  if (process.platform !== 'darwin') return null;

  try {
    const result = execSync(
      `security find-generic-password -s "${CLAUDE_CLI_KEYCHAIN_SERVICE}" -w`,
      { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const data = JSON.parse(result.trim());
    const claudeOauth = data?.claudeAiOauth;
    if (!claudeOauth || typeof claudeOauth !== 'object') return null;

    const { accessToken, expiresAt, refreshToken } = claudeOauth;

    if (typeof accessToken !== 'string' || !accessToken) return null;
    if (typeof expiresAt !== 'number' || expiresAt <= 0) return null;

    return {
      accessToken,
      refreshToken: typeof refreshToken === 'string' ? refreshToken : undefined,
      expiresAt,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Credential Resolution
// ---------------------------------------------------------------------------

export interface ResolvedCredentials {
  type: 'token' | 'api_key';
  value: string;
  source?: 'env' | 'stored' | 'claude-keychain';
}

export function resolveCredentials(): ResolvedCredentials | undefined {
  // Priority 1: Environment variables
  if (process.env.ANTHROPIC_OAUTH_TOKEN) {
    return { type: 'token', value: process.env.ANTHROPIC_OAUTH_TOKEN, source: 'env' };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { type: 'api_key', value: process.env.ANTHROPIC_API_KEY, source: 'env' };
  }

  // Priority 2: Stored credentials
  const creds = loadCredentials('anthropic');
  if (creds) {
    const value = creds.type === 'token' ? creds.token : creds.apiKey;
    if (value) return { type: creds.type, value, source: 'stored' };
  }

  // Priority 3: Claude Code keychain (macOS)
  const claudeCreds = readClaudeCliCredentials();
  if (claudeCreds && claudeCreds.expiresAt > Date.now()) {
    return { type: 'token', value: claudeCreds.accessToken, source: 'claude-keychain' };
  }

  return undefined;
}

/** @deprecated Use resolveCredentials() instead for proper OAuth token support */
export function resolveApiKey(): string | undefined {
  const creds = resolveCredentials();
  return creds?.value;
}

export function hasValidCredentials(): boolean {
  return resolveCredentials() !== undefined;
}
