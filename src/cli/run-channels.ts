/**
 * Channel Initialization for Run Command
 * Loads channel settings, adapters, and wires them into the agentic loop.
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { resolveCredentials } from './credentials';
import { createChannelManager } from '../core/channel-manager';
import { createChannelRouter, type ChannelRouter } from '../core/channel-router';
import type { TranscriptionProvider } from '../core/plugin-api-types';
import type { EnhancedChannel } from '../core/channel-types';
import type { AgenticLoop } from '../core/loop';
import type { EventBus } from '../core/event-bus';
import type { Logger } from '../infra/logger';
import type { Config } from '../core/types';
import type { Database } from '../infra/database';
import type { LLMProvider } from '../core/plugin-api-types';

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
// Plugin Loader Helper
// ---------------------------------------------------------------------------

async function importFirstFound(paths: string[]): Promise<Record<string, unknown> | null> {
  for (const p of paths) {
    if (existsSync(p)) return import(p);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Telegram Adapter Loader
// ---------------------------------------------------------------------------

async function loadTelegramAdapter(logger: Logger): Promise<(new () => EnhancedChannel) | null> {
  const mod = await importFirstFound([
    join(homedir(), '.daemux', 'plugins', 'telegram-adapter', 'dist', 'index.js'),
    join(__dirname, '..', '..', '..', 'daemux-plugins', 'channels', 'telegram-adapter', 'dist', 'index.js'),
  ]);

  if (!mod) {
    logger.warn('Telegram adapter not found, skipping channel');
    return null;
  }

  return mod.TelegramChannel as new () => EnhancedChannel;
}

// ---------------------------------------------------------------------------
// Transcription Plugin Loader
// ---------------------------------------------------------------------------

async function loadTranscriptionPlugin(
  apiKey: string,
  logger: Logger,
): Promise<TranscriptionProvider | undefined> {
  const mod = await importFirstFound([
    join(homedir(), '.daemux', 'plugins', 'transcription', 'src', 'index.ts'),
    join(__dirname, '..', '..', '..', 'daemux-plugins', 'features', 'transcription', 'src', 'index.ts'),
  ]);

  if (!mod) {
    logger.warn('Transcription plugin not found; voice messages will not be transcribed');
    return undefined;
  }

  try {
    const create = mod.createTranscriptionProvider as (opts: { apiKey: string }) => TranscriptionProvider;
    const provider = create({ apiKey });
    logger.info('Transcription provider configured (OpenAI via plugin)');
    return provider;
  } catch (err) {
    logger.warn('Failed to load transcription plugin', {
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Channel Initialization
// ---------------------------------------------------------------------------

const NO_CHANNELS: ChannelInitResult = { router: null, channelIds: [] };

export async function initializeChannels(
  eventBus: EventBus,
  loop: AgenticLoop,
  logger: Logger,
  deps?: { db: Database; provider: LLMProvider; config: Config },
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

  let transcriptionProvider: TranscriptionProvider | undefined;
  const telegramConfig = channelConfigs.get('telegram');
  if (telegramConfig?.openaiApiKey && typeof telegramConfig.openaiApiKey === 'string') {
    transcriptionProvider = await loadTranscriptionPlugin(telegramConfig.openaiApiKey, logger);
  } else {
    logger.warn('No openaiApiKey in telegram channel config; voice transcription disabled');
  }

  warnIfClaudeCodeCredentials(logger);

  const router = createChannelRouter({
    loop, channelManager, eventBus, transcriptionProvider, logger,
    db: deps?.db, provider: deps?.provider, config: deps?.config,
  });
  router.start();

  const channelIds = channelManager.list().map(c => c.id);
  logger.info('Channels initialized', { channels: channelIds.join(', ') });
  return { router, channelIds };
}

// ---------------------------------------------------------------------------
// Credential Warnings
// ---------------------------------------------------------------------------

function warnIfClaudeCodeCredentials(logger: Logger): void {
  const creds = resolveCredentials();
  if (!creds || creds.source === 'claude-keychain') {
    logger.warn(
      'No Anthropic API key found in settings.json, environment, or credentials store. ' +
      'Claude Code keychain tokens cannot be used for API access. ' +
      'Add "anthropicApiKey": "sk-ant-api..." or "sk-ant-oat01-..." to ~/.daemux/settings.json',
    );
  }
}
