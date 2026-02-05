/**
 * Provider registry: maps provider IDs to adapter instances.
 * Built once at startup from validated config. Provides O(1) lookup.
 */

import { logger } from '../shared/logger.js';
import { ConfigError } from '../shared/errors.js';
import type { ProviderConfig } from '../config/types.js';
import type { ProviderAdapter, ProviderRegistry as IProviderRegistry } from './types.js';
import { OpenRouterAdapter } from './adapters/openrouter.js';
import { GroqAdapter } from './adapters/groq.js';
import { CerebrasAdapter } from './adapters/cerebras.js';
import { GenericOpenAIAdapter } from './adapters/generic-openai.js';

/** Registry of provider adapters, keyed by provider ID. */
export class ProviderRegistry implements IProviderRegistry {
  private readonly adapters: Map<string, ProviderAdapter>;

  constructor(adapters: Map<string, ProviderAdapter>) {
    this.adapters = adapters;
  }

  /**
   * Get a provider adapter by ID.
   * @throws ConfigError if the provider ID is not registered.
   */
  get(providerId: string): ProviderAdapter {
    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      const available = Array.from(this.adapters.keys()).join(', ');
      throw new ConfigError(
        `Provider '${providerId}' not found in registry. Available: ${available}`,
      );
    }
    return adapter;
  }

  /** Check whether a provider ID is registered. */
  has(providerId: string): boolean {
    return this.adapters.has(providerId);
  }

  /** Get all registered provider adapters. */
  getAll(): ProviderAdapter[] {
    return Array.from(this.adapters.values());
  }

  /** Number of registered providers. */
  get size(): number {
    return this.adapters.size;
  }
}

/**
 * Build a provider registry from validated config.
 * Creates the correct adapter subclass based on each provider's type.
 *
 * @param providers - Array of validated provider configurations.
 * @returns A ProviderRegistry with all providers registered.
 * @throws ConfigError if a provider type is unknown.
 */
export function buildRegistry(providers: ProviderConfig[]): ProviderRegistry {
  const adapters = new Map<string, ProviderAdapter>();

  for (const config of providers) {
    const adapter = createAdapter(config);
    adapters.set(config.id, adapter);

    logger.info(
      { provider: adapter.id, type: adapter.providerType, baseUrl: adapter.baseUrl },
      `Registered provider: ${adapter.name} (${adapter.providerType}) at ${adapter.baseUrl}`,
    );
  }

  return new ProviderRegistry(adapters);
}

/**
 * Create the correct adapter instance based on provider type.
 * @throws ConfigError if the type is unknown.
 */
function createAdapter(config: ProviderConfig): ProviderAdapter {
  switch (config.type) {
    case 'openrouter':
      return new OpenRouterAdapter(config.id, config.name, config.apiKey, config.baseUrl);
    case 'groq':
      return new GroqAdapter(config.id, config.name, config.apiKey, config.baseUrl);
    case 'cerebras':
      return new CerebrasAdapter(config.id, config.name, config.apiKey, config.baseUrl);
    case 'generic-openai':
      if (!config.baseUrl) {
        throw new ConfigError(
          `Provider '${config.id}' (generic-openai) requires a baseUrl`,
        );
      }
      return new GenericOpenAIAdapter(config.id, config.name, config.apiKey, config.baseUrl);
    default:
      throw new ConfigError(
        `Unknown provider type '${config.type}' for provider '${config.id}'. ` +
        `Supported types: openrouter, groq, cerebras, generic-openai`,
      );
  }
}
