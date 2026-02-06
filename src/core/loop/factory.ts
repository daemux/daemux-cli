/**
 * Agentic Loop Factory
 * Global loop instance management.
 */

import type { Config } from '../types';
import type { Database } from '../../infra/database';
import type { EventBus } from '../event-bus';
import type { LLMProvider } from '../plugin-api-types';
import type { SessionPersistence } from '../session-persistence';
import { AgenticLoop } from './index';

/** @deprecated Use LLMCredentials from plugin-api-types instead */
interface Credentials {
  type: 'token' | 'api_key';
  value: string;
}

let globalLoop: AgenticLoop | null = null;

export function createAgenticLoop(options: {
  db: Database;
  eventBus: EventBus;
  config: Config;
  provider?: LLMProvider;
  persistence?: SessionPersistence;
  /** @deprecated Use provider instead */
  apiKey?: string;
  /** @deprecated Use provider instead */
  credentials?: Credentials;
}): AgenticLoop {
  globalLoop = new AgenticLoop(options);
  return globalLoop;
}

export function getAgenticLoop(): AgenticLoop {
  if (!globalLoop) {
    throw new Error('Agentic loop not initialized. Call createAgenticLoop first.');
  }
  return globalLoop;
}
