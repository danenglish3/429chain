/**
 * Waterfall chain router.
 * Iterates through chain entries in order, skipping exhausted providers,
 * and returns the first successful response. On any provider failure
 * (429, 5xx, timeout, connection error), waterfalls to the next entry.
 *
 * This is the core value proposition of 429chain: requests never fail
 * when free tokens exist somewhere in the chain.
 */

import { logger } from '../shared/logger.js';
import {
  AllProvidersExhaustedError,
  ProviderRateLimitError,
  ProviderError,
} from '../shared/errors.js';
import type { AttemptRecord, ChatCompletionRequest } from '../shared/types.js';
import type { ProviderRegistry } from '../providers/types.js';
import type { RateLimitTracker } from '../ratelimit/tracker.js';
import type { Chain, ChainResult, StreamChainResult } from './types.js';

/**
 * Execute a chain: iterate entries in order, skip exhausted providers,
 * waterfall on any failure, return first success.
 *
 * @param chain - The chain to execute (ordered list of provider+model entries).
 * @param request - The incoming chat completion request.
 * @param tracker - Rate limit tracker to check/update provider state.
 * @param registry - Provider adapter registry.
 * @returns The successful chain result including response and metadata.
 * @throws AllProvidersExhaustedError when all entries fail or are skipped.
 */
export async function executeChain(
  chain: Chain,
  request: ChatCompletionRequest,
  tracker: RateLimitTracker,
  registry: ProviderRegistry,
): Promise<ChainResult> {
  const attempts: AttemptRecord[] = [];

  for (const entry of chain.entries) {
    // Check if this provider+model is on cooldown
    if (tracker.isExhausted(entry.providerId, entry.model)) {
      logger.info(
        { provider: entry.providerId, model: entry.model, chain: chain.name },
        `Skipping ${entry.providerId}/${entry.model} (on cooldown)`,
      );

      attempts.push({
        provider: entry.providerId,
        model: entry.model,
        error: 'on_cooldown',
        skipped: true,
      });
      continue;
    }

    // Get the adapter for this provider
    const adapter = registry.get(entry.providerId);
    const attemptStart = performance.now();

    try {
      const result = await adapter.chatCompletion(entry.model, request);

      const latencyMs = performance.now() - attemptStart;

      // Parse rate limit headers from successful response
      const rateLimitInfo = adapter.parseRateLimitHeaders(result.headers);
      if (rateLimitInfo && rateLimitInfo.remainingRequests === 0) {
        // Proactively mark exhausted: this was the last allowed request
        const cooldownMs = rateLimitInfo.resetRequestsMs ?? undefined;
        tracker.markExhausted(
          entry.providerId,
          entry.model,
          cooldownMs,
          'proactive: remaining requests = 0',
        );
      }

      logger.info(
        {
          provider: entry.providerId,
          model: entry.model,
          chain: chain.name,
          latencyMs: Math.round(latencyMs),
          attemptsCount: attempts.length + 1,
        },
        `Chain "${chain.name}" served by ${entry.providerId}/${entry.model} (${Math.round(latencyMs)}ms, ${attempts.length + 1} attempt(s))`,
      );

      return {
        response: result.body,
        providerId: entry.providerId,
        model: entry.model,
        latencyMs,
        attempts,
      };
    } catch (error: unknown) {
      const latencyMs = performance.now() - attemptStart;

      if (error instanceof ProviderRateLimitError) {
        // 429 rate limited: extract retry-after and mark exhausted
        const retryAfterHeader = error.headers.get('retry-after');
        let retryAfterMs: number | undefined;
        if (retryAfterHeader) {
          const seconds = parseInt(retryAfterHeader, 10);
          if (!isNaN(seconds)) {
            retryAfterMs = seconds * 1000;
          }
        }

        tracker.markExhausted(
          entry.providerId,
          entry.model,
          retryAfterMs,
          '429 rate limited',
        );

        logger.info(
          {
            provider: entry.providerId,
            model: entry.model,
            chain: chain.name,
            latencyMs: Math.round(latencyMs),
            retryAfterMs,
          },
          `Provider ${entry.providerId}/${entry.model} returned 429, waterfalling`,
        );

        attempts.push({
          provider: entry.providerId,
          model: entry.model,
          error: '429_rate_limited',
          retryAfter: retryAfterMs,
        });
        continue;
      }

      if (error instanceof ProviderError) {
        // Non-429 provider error (5xx, etc.): waterfall to next
        logger.info(
          {
            provider: entry.providerId,
            model: entry.model,
            chain: chain.name,
            statusCode: error.statusCode,
            latencyMs: Math.round(latencyMs),
          },
          `Provider ${entry.providerId}/${entry.model} returned ${error.statusCode}, waterfalling`,
        );

        attempts.push({
          provider: entry.providerId,
          model: entry.model,
          error: `${error.statusCode}: ${error.message}`,
        });
        continue;
      }

      // Unknown error (network timeout, DNS failure, connection refused, etc.)
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.info(
        {
          provider: entry.providerId,
          model: entry.model,
          chain: chain.name,
          error: errorMessage,
          latencyMs: Math.round(latencyMs),
        },
        `Provider ${entry.providerId}/${entry.model} failed: ${errorMessage}, waterfalling`,
      );

      attempts.push({
        provider: entry.providerId,
        model: entry.model,
        error: errorMessage,
      });
      continue;
    }
  }

  // All entries exhausted or failed
  logger.warn(
    {
      chain: chain.name,
      totalAttempts: attempts.length,
      attempts,
    },
    `All providers exhausted in chain "${chain.name}"`,
  );

  throw new AllProvidersExhaustedError(chain.name, attempts);
}

/**
 * Execute a chain for streaming: iterate entries in order, skip exhausted,
 * waterfall on failure, return the first successful raw streaming Response.
 *
 * This performs PRE-STREAM validation: the provider connection is opened
 * and validated (non-429, non-error) BEFORE returning to the caller.
 * The caller then pipes the ReadableStream body to the client.
 */
export async function executeStreamChain(
  chain: Chain,
  request: ChatCompletionRequest,
  tracker: RateLimitTracker,
  registry: ProviderRegistry,
  signal?: AbortSignal,
): Promise<StreamChainResult> {
  const attempts: AttemptRecord[] = [];

  for (const entry of chain.entries) {
    if (tracker.isExhausted(entry.providerId, entry.model)) {
      logger.info(
        { provider: entry.providerId, model: entry.model, chain: chain.name },
        `Skipping ${entry.providerId}/${entry.model} (on cooldown) [stream]`,
      );
      attempts.push({
        provider: entry.providerId,
        model: entry.model,
        error: 'on_cooldown',
        skipped: true,
      });
      continue;
    }

    const adapter = registry.get(entry.providerId);

    try {
      const response = await adapter.chatCompletionStream(entry.model, request, signal);

      logger.info(
        {
          provider: entry.providerId,
          model: entry.model,
          chain: chain.name,
          attemptsCount: attempts.length + 1,
        },
        `Stream opened from ${entry.providerId}/${entry.model} (${attempts.length + 1} attempt(s))`,
      );

      return {
        response,
        providerId: entry.providerId,
        model: entry.model,
        attempts,
      };
    } catch (error: unknown) {
      if (error instanceof ProviderRateLimitError) {
        const retryAfterHeader = error.headers.get('retry-after');
        let retryAfterMs: number | undefined;
        if (retryAfterHeader) {
          const seconds = parseInt(retryAfterHeader, 10);
          if (!isNaN(seconds)) {
            retryAfterMs = seconds * 1000;
          }
        }

        tracker.markExhausted(
          entry.providerId,
          entry.model,
          retryAfterMs,
          '429 rate limited (streaming)',
        );

        logger.info(
          { provider: entry.providerId, model: entry.model, chain: chain.name, retryAfterMs },
          `Provider ${entry.providerId}/${entry.model} returned 429 [stream], waterfalling`,
        );

        attempts.push({
          provider: entry.providerId,
          model: entry.model,
          error: '429_rate_limited',
          retryAfter: retryAfterMs,
        });
        continue;
      }

      if (error instanceof ProviderError) {
        logger.info(
          { provider: entry.providerId, model: entry.model, chain: chain.name, statusCode: error.statusCode },
          `Provider ${entry.providerId}/${entry.model} returned ${error.statusCode} [stream], waterfalling`,
        );
        attempts.push({
          provider: entry.providerId,
          model: entry.model,
          error: `${error.statusCode}: ${error.message}`,
        });
        continue;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);

      // If this is an AbortError, the client disconnected -- don't waterfall, just throw
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }

      logger.info(
        { provider: entry.providerId, model: entry.model, chain: chain.name, error: errorMessage },
        `Provider ${entry.providerId}/${entry.model} failed [stream]: ${errorMessage}, waterfalling`,
      );
      attempts.push({
        provider: entry.providerId,
        model: entry.model,
        error: errorMessage,
      });
      continue;
    }
  }

  logger.warn(
    { chain: chain.name, totalAttempts: attempts.length, attempts },
    `All providers exhausted in chain "${chain.name}" [stream]`,
  );

  throw new AllProvidersExhaustedError(chain.name, attempts);
}

/**
 * Resolve a chain name to a Chain object.
 * If no chain name is specified, uses the default chain.
 *
 * @param chainName - Optional chain name from the request.
 * @param chains - Map of chain name to Chain object.
 * @param defaultChainName - Default chain name from config.
 * @returns The resolved Chain object.
 * @throws Error if the chain name is not found.
 */
export function resolveChain(
  chainName: string | undefined,
  chains: Map<string, Chain>,
  defaultChainName: string,
): Chain {
  const name = chainName ?? defaultChainName;
  const chain = chains.get(name);

  if (!chain) {
    throw new Error(
      `Chain "${name}" not found. Available chains: ${[...chains.keys()].join(', ')}`,
    );
  }

  return chain;
}
