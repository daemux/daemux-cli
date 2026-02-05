/**
 * Authentication Commands
 * Token and API key management for Anthropic provider
 */

import { Command } from 'commander';
import {
  createSpinner,
  promptSecret,
  printError,
  printInfo,
  success,
  warning,
  dim,
  bold,
} from './utils';
import {
  TOKEN_PREFIX,
  API_KEY_PREFIX,
  TOKEN_MIN_LENGTH,
  SUPPORTED_PROVIDERS,
  type Provider,
  type Credentials,
  getCredentialsPath,
  loadCredentials,
  saveCredentials,
  clearCredentials,
  getEnvCredentials,
  verifyCredentials,
  resolveCredentials,
  resolveApiKey,
  hasValidCredentials,
  readClaudeCliCredentials,
  type ResolvedCredentials,
} from './credentials';

// Re-export credential resolution functions for backward compatibility
export { resolveCredentials, resolveApiKey, hasValidCredentials };
export type { ResolvedCredentials };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

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

function validateProvider(provider: string): provider is Provider {
  return SUPPORTED_PROVIDERS.includes(provider as Provider);
}

// ---------------------------------------------------------------------------
// Setup Credentials Commands
// ---------------------------------------------------------------------------

async function setupCredential(
  type: 'token' | 'api_key',
  options: { provider: string }
): Promise<void> {
  if (!validateProvider(options.provider)) {
    printError(`Unsupported provider: ${options.provider}. Supported: ${SUPPORTED_PROVIDERS.join(', ')}`);
    process.exit(1);
  }

  const isToken = type === 'token';
  const label = isToken ? 'Token' : 'API Key';
  const prefix = isToken ? TOKEN_PREFIX : API_KEY_PREFIX;

  console.log(bold(`\nSetup ${label}\n`));

  if (isToken) {
    console.log(warning('Note: Setup tokens are restricted to Claude Code use only.'));
    console.log(warning('They cannot be used for general API access outside Claude Code.\n'));
    console.log('For general API access, use: daemux auth api-key');
    console.log('Or get an API key from: https://console.anthropic.com\n');
    console.log('To get your setup token (Claude Code only):');
    console.log(dim('  1. Run \'claude setup-token\' in Claude Code terminal'));
    console.log(dim('  2. Copy the token that starts with "sk-ant-oat01-"'));
    console.log(dim('  3. Paste it below\n'));
  } else {
    console.log(dim(`Paste your ${label.toLowerCase()} from Anthropic Console.`));
    console.log(dim(`The ${label.toLowerCase()} should start with "${prefix}".\n`));
  }

  const value = await promptSecret(`${label}:`);
  const validation = validateCredential(value, type);

  if (!validation.valid) {
    printError(validation.error!);
    process.exit(1);
  }

  const verifySpinner = createSpinner('Verifying credentials with Anthropic API');
  verifySpinner.start();

  const verification = await verifyCredentials(value, type);
  if (!verification.valid) {
    verifySpinner.fail('Credentials verification failed');
    printError(verification.error!);
    process.exit(1);
  }
  verifySpinner.succeed('Credentials verified successfully');

  const spinner = createSpinner('Saving credentials');
  spinner.start();

  try {
    const credentials: Credentials = {
      type,
      provider: options.provider,
      token: isToken ? value : undefined,
      apiKey: isToken ? undefined : value,
      expires: null,
      createdAt: Date.now(),
    };

    saveCredentials(options.provider, credentials);
    spinner.succeed('Credentials saved successfully');
    printInfo(`Stored in: ${getCredentialsPath(options.provider)}`);
  } catch (err) {
    spinner.fail('Failed to save credentials');
    printError(err);
    process.exit(1);
  }
}

const setupToken = (options: { provider: string }) => setupCredential('token', options);
const setupApiKey = (options: { provider: string }) => setupCredential('api_key', options);

// ---------------------------------------------------------------------------
// Status Command
// ---------------------------------------------------------------------------

function maskCredential(value?: string): string {
  if (!value) return 'N/A';
  if (value.length < 20) return '*'.repeat(value.length);
  return `${value.slice(0, 15)}...${value.slice(-4)}`;
}

async function showStatus(): Promise<void> {
  console.log(bold('\nAuthentication Status\n'));

  // Check environment variables first
  const envCreds = getEnvCredentials();
  if (envCreds) {
    console.log(`${success('✓')} Environment variable: ${envCreds.type === 'token' ? 'ANTHROPIC_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY'}`);
    console.log(dim('  (Environment variables take priority over stored credentials)\n'));
  }

  // Check stored credentials
  let hasStored = false;
  for (const provider of SUPPORTED_PROVIDERS) {
    const creds = loadCredentials(provider);
    if (creds) {
      hasStored = true;
      const maskedValue = maskCredential(creds.type === 'token' ? creds.token : creds.apiKey);
      const createdDate = new Date(creds.createdAt).toLocaleDateString();

      console.log(`${success('✓')} ${bold(provider)}`);
      console.log(`  Type: ${creds.type}`);
      console.log(`  Value: ${maskedValue}`);
      console.log(`  Created: ${createdDate}`);
      console.log(`  Path: ${dim(getCredentialsPath(provider))}\n`);
    }
  }

  // Check Claude Code keychain (macOS only)
  const claudeCreds = readClaudeCliCredentials();
  if (claudeCreds) {
    const isExpired = claudeCreds.expiresAt <= Date.now();
    const expiresDate = new Date(claudeCreds.expiresAt).toLocaleString();
    const statusIcon = isExpired ? warning('!') : success('✓');

    console.log(`${statusIcon} ${bold('Claude Code Keychain')} (macOS)`);
    console.log(`  Type: oauth`);
    console.log(`  Token: ${maskCredential(claudeCreds.accessToken)}`);
    console.log(`  Has Refresh: ${claudeCreds.refreshToken ? 'yes' : 'no'}`);
    console.log(`  Expires: ${expiresDate}${isExpired ? dim(' (expired)') : ''}`);
    console.log(dim('  (Automatically used when no other credentials are configured)\n'));
  }

  if (!envCreds && !hasStored && !claudeCreds) {
    console.log(`${warning('!')} No credentials configured.\n`);
    console.log('To configure authentication, run:');
    console.log(dim('  daemux auth api-key --provider anthropic\n'));
    console.log('Or set environment variables:');
    console.log(dim('  export ANTHROPIC_API_KEY=sk-ant-api...\n'));
    console.log('Note: Setup tokens (sk-ant-oat01-...) are restricted to Claude Code only.');
    console.log('For general API access, use an API key from console.anthropic.com\n');
  }
}

// ---------------------------------------------------------------------------
// Clear Command
// ---------------------------------------------------------------------------

async function clearAuth(options: { provider: string }): Promise<void> {
  if (!validateProvider(options.provider)) {
    printError(`Unsupported provider: ${options.provider}. Supported: ${SUPPORTED_PROVIDERS.join(', ')}`);
    process.exit(1);
  }

  const spinner = createSpinner(`Removing ${options.provider} credentials`);
  spinner.start();

  if (clearCredentials(options.provider)) {
    spinner.succeed(`Removed ${options.provider} credentials`);
  } else {
    spinner.warn(`No stored credentials found for ${options.provider}`);
  }
}

// ---------------------------------------------------------------------------
// Command Registration
// ---------------------------------------------------------------------------

export function registerAuthCommands(program: Command): void {
  const auth = program
    .command('auth')
    .description('Manage authentication credentials');

  auth
    .command('setup-token')
    .description('Configure OAuth token from Claude subscription')
    .option('-p, --provider <provider>', 'Provider name', 'anthropic')
    .action(setupToken);

  auth
    .command('api-key')
    .description('Configure API key from Anthropic Console')
    .option('-p, --provider <provider>', 'Provider name', 'anthropic')
    .action(setupApiKey);

  auth
    .command('status')
    .description('Show authentication status')
    .action(showStatus);

  auth
    .command('clear')
    .description('Remove stored credentials')
    .option('-p, --provider <provider>', 'Provider name', 'anthropic')
    .action(clearAuth);
}
