/**
 * Chain types for waterfall execution.
 * A chain is an ordered list of provider+model entries that the router
 * iterates through during request handling.
 */

import type { AttemptRecord, ChatCompletionResponse } from '../shared/types.js';
import type { Config } from '../config/types.js';
import type { ProviderRegistry } from '../providers/types.js';

/** A single entry in a chain: a specific provider+model combination. */
export interface ChainEntry {
  /** Provider instance ID (references config provider.id). */
  providerId: string;
  /** Model ID to request from this provider. */
  model: string;
}

/** A named chain of ordered provider+model entries. */
export interface Chain {
  /** Chain name (from config). */
  name: string;
  /** Ordered list of provider+model entries to try. */
  entries: ChainEntry[];
}

/** Result of a successful chain execution. */
export interface ChainResult {
  /** The chat completion response body. */
  response: ChatCompletionResponse;
  /** The provider that served the successful response. */
  providerId: string;
  /** The model that generated the response. */
  model: string;
  /** Request latency in milliseconds. */
  latencyMs: number;
  /** Record of all attempts made (including skipped and failed). */
  attempts: AttemptRecord[];
}

/** Result of a successful streaming chain execution (pre-stream phase). */
export interface StreamChainResult {
  /** Raw fetch Response with unconsumed ReadableStream body. */
  response: Response;
  /** The provider that opened the stream. */
  providerId: string;
  /** The model being streamed. */
  model: string;
  /** Record of all attempts made before finding a working provider. */
  attempts: AttemptRecord[];
}

/**
 * Build runtime Chain objects from config and a provider registry.
 * Validates that each chain entry references a registered provider.
 * @param config - Validated proxy configuration.
 * @param registry - Registry of provider adapters.
 * @returns Map of chain name to Chain object.
 */
export function buildChains(
  config: Config,
  registry: ProviderRegistry,
): Map<string, Chain> {
  const chains = new Map<string, Chain>();

  for (const chainConfig of config.chains) {
    const entries: ChainEntry[] = [];

    for (const entry of chainConfig.entries) {
      // Defensive check: provider should exist (already validated by Zod refine)
      if (!registry.has(entry.provider)) {
        throw new Error(
          `Chain "${chainConfig.name}" references unknown provider "${entry.provider}"`,
        );
      }

      entries.push({
        providerId: entry.provider,
        model: entry.model,
      });
    }

    chains.set(chainConfig.name, {
      name: chainConfig.name,
      entries,
    });
  }

  return chains;
}
