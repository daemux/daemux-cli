/**
 * Anthropic Provider Loader
 * Shared utility for loading the Anthropic LLM provider plugin.
 */

import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';
import type { LLMProvider } from '../core/plugin-api-types';

const PROVIDER_PATH = join(homedir(), '.daemux', 'plugins', 'anthropic-provider', 'dist', 'index.js');

export async function loadAnthropicProvider(): Promise<LLMProvider> {
  if (existsSync(PROVIDER_PATH)) {
    const mod = await import(PROVIDER_PATH);
    return mod.createProvider() as LLMProvider;
  }

  throw new Error(
    'Anthropic provider plugin not found. Install it to ~/.daemux/plugins/anthropic-provider/ ' +
    'or run: daemux plugins install @daemux/anthropic-provider',
  );
}
