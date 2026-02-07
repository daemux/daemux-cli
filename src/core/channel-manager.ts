/**
 * Channel Manager
 * Singleton registry for channel instances with lifecycle management.
 * Channels register here and can be connected/disconnected as a group.
 */

import type { EnhancedChannel } from './channel-types';
import type { EventBus } from './event-bus';

// ---------------------------------------------------------------------------
// Channel Manager
// ---------------------------------------------------------------------------

export class ChannelManager {
  private channels: Map<string, EnhancedChannel> = new Map();
  private eventBus: EventBus | null;

  constructor(options?: { eventBus?: EventBus }) {
    this.eventBus = options?.eventBus ?? null;
  }

  /** Register a channel instance */
  register(channel: EnhancedChannel): void {
    if (this.channels.has(channel.id)) {
      throw new Error(`Channel '${channel.id}' already registered`);
    }
    this.channels.set(channel.id, channel);
  }

  /** Unregister a channel instance */
  unregister(channelId: string): boolean {
    return this.channels.delete(channelId);
  }

  /** Get a channel by ID */
  get(channelId: string): EnhancedChannel | undefined {
    return this.channels.get(channelId);
  }

  /** Get all registered channels */
  list(): EnhancedChannel[] {
    return Array.from(this.channels.values());
  }

  /** Get the event bus (if configured) */
  getEventBus(): EventBus | null {
    return this.eventBus;
  }

  /** Connect all registered channels with their configs */
  async connectAll(
    configs: Map<string, Record<string, unknown>>,
  ): Promise<void> {
    const errors: Array<{ channelId: string; error: Error }> = [];

    for (const [id, channel] of this.channels) {
      const config = configs.get(id);
      if (!config) continue;

      try {
        await channel.connect(config);
      } catch (err) {
        errors.push({
          channelId: id,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }

    if (errors.length > 0) {
      const details = errors
        .map((e) => `${e.channelId}: ${e.error.message}`)
        .join('; ');
      throw new Error(`Failed to connect channels: ${details}`);
    }
  }

  /** Disconnect all connected channels */
  async disconnectAll(): Promise<void> {
    for (const channel of this.channels.values()) {
      if (channel.connected) {
        try {
          await channel.disconnect();
        } catch {
          // Continue disconnecting remaining channels
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let globalManager: ChannelManager | null = null;

export function createChannelManager(
  options?: { eventBus?: EventBus },
): ChannelManager {
  globalManager = new ChannelManager(options);
  return globalManager;
}

export function getChannelManager(): ChannelManager {
  if (!globalManager) {
    globalManager = new ChannelManager();
  }
  return globalManager;
}
