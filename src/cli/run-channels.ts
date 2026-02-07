/**
 * Channel Initialization for Run Command
 * Loads channel settings, adapters, and wires them into the agentic loop.
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createChannelManager } from '../core/channel-manager';
import { createChannelRouter, type ChannelRouter } from '../core/channel-router';
import { createTranscriptionProvider } from '../core/transcription';
import type { EnhancedChannel } from '../core/channel-types';
import type { AgenticLoop } from '../core/loop';
import type { EventBus } from '../core/event-bus';
import type { Logger } from '../infra/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChannelSettingsFile {
  channels?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ChannelInitResult {
  router: ChannelRouter | null;
  channelIds: string[];
}

// ---------------------------------------------------------------------------
// Channel Settings
// ---------------------------------------------------------------------------

function loadChannelSettings(): Map<string, Record<string, unknown>> {
  const settingsPath = join(homedir(), '.daemux', 'settings.json');
  const configs = new Map<string, Record<string, unknown>>();

  if (!existsSync(settingsPath)) return configs;

  try {
    const data = JSON.parse(readFileSync(settingsPath, 'utf-8')) as ChannelSettingsFile;
    if (data.channels) {
      for (const [id, config] of Object.entries(data.channels)) {
        configs.set(id, config);
      }
    }
  } catch {
    // Ignore parse errors - channels just won't be available
  }

  return configs;
}

// ---------------------------------------------------------------------------
// Telegram Adapter Loader
// ---------------------------------------------------------------------------

async function loadTelegramAdapter(logger: Logger): Promise<(new () => EnhancedChannel) | null> {
  const paths = [
    join(homedir(), '.daemux', 'plugins', 'telegram-adapter', 'dist', 'index.js'),
    join(__dirname, '..', '..', '..', 'daemux-plugins', 'channels', 'telegram-adapter', 'dist', 'index.js'),
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      const mod = await import(p);
      return mod.TelegramChannel as new () => EnhancedChannel;
    }
  }

  logger.warn('Telegram adapter not found, skipping channel');
  return null;
}

// ---------------------------------------------------------------------------
// Channel Initialization
// ---------------------------------------------------------------------------

const NO_CHANNELS: ChannelInitResult = { router: null, channelIds: [] };

export async function initializeChannels(
  eventBus: EventBus,
  loop: AgenticLoop,
  logger: Logger,
): Promise<ChannelInitResult> {
  const channelConfigs = loadChannelSettings();
  if (channelConfigs.size === 0) return NO_CHANNELS;

  const channelManager = createChannelManager({ eventBus });

  if (channelConfigs.has('telegram')) {
    try {
      const TelegramChannel = await loadTelegramAdapter(logger);
      if (!TelegramChannel) return NO_CHANNELS;
      channelManager.register(new TelegramChannel());
    } catch (err) {
      logger.error('Failed to load Telegram adapter', {
        error: err instanceof Error ? err.message : String(err),
      });
      return NO_CHANNELS;
    }
  }

  if (channelManager.list().length === 0) return NO_CHANNELS;

  try {
    await channelManager.connectAll(channelConfigs);
  } catch (err) {
    logger.error('Channel connection failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NO_CHANNELS;
  }

  let transcriptionProvider: ReturnType<typeof createTranscriptionProvider> | undefined;
  const telegramConfig = channelConfigs.get('telegram');
  if (telegramConfig?.openaiApiKey && typeof telegramConfig.openaiApiKey === 'string') {
    transcriptionProvider = createTranscriptionProvider({ apiKey: telegramConfig.openaiApiKey });
    logger.info('Transcription provider configured (OpenAI)');
  } else {
    logger.warn('No openaiApiKey in telegram channel config; voice transcription disabled');
  }

  warnIfClaudeCodeCredentials(logger);

  const router = createChannelRouter({ loop, channelManager, eventBus, transcriptionProvider, logger });
  router.start();

  const channelIds = channelManager.list().map(c => c.id);
  logger.info('Channels initialized', { channels: channelIds.join(', ') });
  return { router, channelIds };
}

// ---------------------------------------------------------------------------
// Credential Warnings
// ---------------------------------------------------------------------------

function warnIfClaudeCodeCredentials(logger: Logger): void {
  const settingsPath = join(homedir(), '.daemux', 'settings.json');
  if (!existsSync(settingsPath)) return;

  try {
    const data = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
    if (data.anthropicApiKey) return; // Has explicit API key, no warning needed
  } catch {
    return;
  }

  // Check if env vars provide credentials
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_OAUTH_TOKEN) return;

  // Check for stored credentials
  const credsPath = join(homedir(), '.daemux', 'credentials', 'anthropic.json');
  if (existsSync(credsPath)) return;

  logger.warn(
    'No Anthropic API key found in settings.json, environment, or credentials store. ' +
    'Claude Code keychain tokens cannot be used for API access. ' +
    'Add "anthropicApiKey": "sk-ant-api..." to ~/.daemux/settings.json',
  );
}
