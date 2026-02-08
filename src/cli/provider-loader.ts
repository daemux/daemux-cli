/**
 * Anthropic Provider Loader
 * Shared utility for loading the Anthropic LLM provider plugin.
 */

import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';
import type { LLMProvider } from '../core/plugin-api-types';

const PROVIDER_PATHS = [
  join(homedir(), '.daemux', 'plugins', 'anthropic-provider', 'dist', 'index.js'),
  join(__dirname, '..', '..', '..', 'daemux-plugins', 'llm-providers', 'anthropic-provider', 'dist', 'index.js'),
];

export async function loadAnthropicProvider(): Promise<LLMProvider> {
  for (const p of PROVIDER_PATHS) {
    if (existsSync(p)) {
      const mod = await import(p);
      return mod.createProvider() as LLMProvider;
    }
  }

  throw new Error(
    'Anthropic provider plugin not found. Install it to ~/.daemux/plugins/anthropic-provider/ ' +
    'or run: daemux plugins install @daemux/anthropic-provider',
  );
}
