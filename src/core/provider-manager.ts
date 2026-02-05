/**
 * Provider Manager
 * Manages LLM provider registration, selection, and lifecycle
 */

import type {
  LLMProvider,
  LLMCredentials,
  LLMModel,
  LLMProviderCapabilities,
} from './plugin-api-types';
import { getLogger } from '../infra/logger';

// ---------------------------------------------------------------------------
// Provider Manager Class
// ---------------------------------------------------------------------------

export class ProviderManager {
  private providers: Map<string, LLMProvider> = new Map();
  private activeProviderId: string | null = null;

  /**
   * Register a provider
   * Providers are registered but not initialized until setActiveProvider is called
   */
  registerProvider(provider: LLMProvider): void {
    if (this.providers.has(provider.id)) {
      getLogger().warn(`Provider ${provider.id} already registered, replacing`);
    }
    this.providers.set(provider.id, provider);
    getLogger().debug(`Provider registered: ${provider.id}`);
  }

  /**
   * Unregister a provider
   */
  async unregisterProvider(id: string): Promise<void> {
    const provider = this.providers.get(id);
    if (!provider) return;

    if (provider.isReady()) {
      await provider.shutdown();
    }

    if (this.activeProviderId === id) {
      this.activeProviderId = null;
    }

    this.providers.delete(id);
    getLogger().debug(`Provider unregistered: ${id}`);
  }

  /**
   * Get a provider by ID
   */
  getProvider(id: string): LLMProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Get the currently active provider
   * Returns null if no provider is active
   */
  getActiveProvider(): LLMProvider | null {
    if (!this.activeProviderId) return null;
    return this.providers.get(this.activeProviderId) ?? null;
  }

  /**
   * Get the active provider ID
   */
  getActiveProviderId(): string | null {
    return this.activeProviderId;
  }

  /**
   * Set and initialize the active provider
   */
  async setActiveProvider(id: string, credentials: LLMCredentials): Promise<void> {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`Provider ${id} not registered`);
    }

    // Shutdown current active provider if different
    if (this.activeProviderId && this.activeProviderId !== id) {
      const currentProvider = this.providers.get(this.activeProviderId);
      if (currentProvider?.isReady()) {
        await currentProvider.shutdown();
      }
    }

    // Initialize the new provider
    if (!provider.isReady()) {
      await provider.initialize(credentials);
    }

    this.activeProviderId = id;
    getLogger().info(`Active provider set: ${id}`);
  }

  /**
   * List all registered providers
   */
  listProviders(): LLMProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Check if any providers are registered
   */
  hasProviders(): boolean {
    return this.providers.size > 0;
  }

  /**
   * Get available models from all registered providers
   */
  listAllModels(): Array<{ providerId: string; models: LLMModel[] }> {
    return Array.from(this.providers.entries()).map(([providerId, provider]) => ({
      providerId,
      models: provider.listModels(),
    }));
  }

  /**
   * Get capabilities of all registered providers
   */
  listCapabilities(): Array<{ providerId: string; capabilities: LLMProviderCapabilities }> {
    return Array.from(this.providers.entries()).map(([providerId, provider]) => ({
      providerId,
      capabilities: provider.capabilities,
    }));
  }

  /**
   * Verify credentials for a specific provider
   */
  async verifyCredentials(
    providerId: string,
    credentials: LLMCredentials
  ): Promise<{ valid: boolean; error?: string }> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      return { valid: false, error: `Provider ${providerId} not registered` };
    }
    return provider.verifyCredentials(credentials);
  }

  /**
   * Shutdown all providers
   */
  async shutdownAll(): Promise<void> {
    const shutdownPromises: Promise<void>[] = [];
    for (const provider of this.providers.values()) {
      if (provider.isReady()) {
        shutdownPromises.push(provider.shutdown());
      }
    }
    await Promise.all(shutdownPromises);
    this.activeProviderId = null;
    getLogger().info('All providers shutdown');
  }
}

// ---------------------------------------------------------------------------
// Global Instance
// ---------------------------------------------------------------------------

let globalProviderManager: ProviderManager | null = null;

/**
 * Create and initialize the global provider manager
 */
export function createProviderManager(): ProviderManager {
  globalProviderManager = new ProviderManager();
  return globalProviderManager;
}

/**
 * Get the global provider manager
 * Throws if not initialized
 */
export function getProviderManager(): ProviderManager {
  if (!globalProviderManager) {
    throw new Error('Provider manager not initialized. Call createProviderManager first.');
  }
  return globalProviderManager;
}

/**
 * Check if provider manager is initialized
 */
export function hasProviderManager(): boolean {
  return globalProviderManager !== null;
}
