/**
 * CLI Commands for Channel Configuration
 * daemux channels list     - list configured channels
 * daemux channels configure telegram - interactive setup
 */

import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import {
  bold,
  dim,
  success,
  printInfo,
  printError,
  prompt,
  promptSecret,
} from './utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChannelSettingsFile {
  channels?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Paths & Helpers
// ---------------------------------------------------------------------------

const getSettingsPath = (): string =>
  join(homedir(), '.daemux', 'settings.json');

function loadSettings(): ChannelSettingsFile {
  const path = getSettingsPath();
  if (!existsSync(path)) return {};
  try {
    chmodSync(path, 0o600);
    return JSON.parse(readFileSync(path, 'utf-8')) as ChannelSettingsFile;
  } catch {
    return {};
  }
}

function saveSettings(settings: ChannelSettingsFile): void {
  const dir = join(homedir(), '.daemux');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), {
    mode: 0o600,
  });
}

// ---------------------------------------------------------------------------
// Configure Telegram
// ---------------------------------------------------------------------------

async function configureTelegram(): Promise<void> {
  console.log(bold('\nConfigure Telegram Channel\n'));

  const botToken = await promptSecret('Bot token (from @BotFather):');
  if (!botToken?.trim()) {
    printError('Bot token is required');
    return;
  }

  const userIdsRaw = await prompt(
    'Allowed user IDs (comma-separated, empty for all):',
  );
  const allowedUserIds = userIdsRaw
    ? userIdsRaw
        .split(',')
        .map((id) => parseInt(id.trim(), 10))
        .filter(Number.isFinite)
    : [];

  const openaiKey = await promptSecret(
    'OpenAI API key (for voice transcription, optional):',
  );

  const settings = loadSettings();
  settings.channels = settings.channels ?? {};
  settings.channels['telegram'] = {
    botToken: botToken.trim(),
    allowedUserIds,
    ...(openaiKey?.trim() ? { openaiApiKey: openaiKey.trim() } : {}),
  };

  saveSettings(settings);
  console.log();
  printInfo('Telegram channel configured');
  printInfo(`Settings saved to ${getSettingsPath()}`);
}

// ---------------------------------------------------------------------------
// List Channels
// ---------------------------------------------------------------------------

async function listChannels(): Promise<void> {
  const settings = loadSettings();
  const channels = settings.channels;

  if (!channels || Object.keys(channels).length === 0) {
    console.log(dim('\nNo channels configured.\n'));
    console.log('To configure a channel:');
    console.log(dim('  daemux channels configure telegram\n'));
    return;
  }

  console.log(bold('\nConfigured Channels\n'));
  for (const [name, config] of Object.entries(channels)) {
    const hasToken = typeof config['botToken'] === 'string';
    const status = hasToken ? success('configured') : dim('incomplete');
    console.log(`  ${name}: ${status}`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerChannelCommands(program: Command): void {
  const channels = program
    .command('channels')
    .description('Manage communication channels');

  channels
    .command('list')
    .description('List configured channels')
    .action(listChannels);

  channels
    .command('configure <type>')
    .description('Configure a channel (e.g., telegram)')
    .action(async (type: string) => {
      if (type === 'telegram') {
        await configureTelegram();
      } else {
        printError(`Unknown channel type: ${type}`);
        console.log(dim('Supported types: telegram'));
      }
    });
}
