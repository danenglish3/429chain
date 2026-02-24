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

interface RateLimitDetails {
  type: string; // e.g., 'rate_limit', 'tokens_limit', 'requests_limit', 'unknown'
  message: string; // truncated provider message for logging
  reason: string; // full reason string for cooldown tracking
  rawSnippet?: string; // raw response snippet for debugging generic messages
}

/**
 * Parse rate limit details from provider error response body.
 * Different providers return different formats, this attempts to extract useful info.
 */
function parseRateLimitDetails(responseBody: string): RateLimitDetails {
  if (!responseBody) {
    return { type: 'unknown', message: '', reason: '429 rate limited' };
  }

  try {
    const parsed = JSON.parse(responseBody);

    // OpenRouter format: { error: { code: number, message: string, metadata?: { ... } } }
    // OpenAI format: { error: { type: string, code: string, message: string } }
    const error = parsed.error || parsed;
    const code = error.code || error.type || '';
    let message = error.message || '';
    const metadata = error.metadata || {};

    // If message is generic, try to extract more from metadata
    const isGenericMessage = !message ||
      message === 'Provider returned error' ||
      message === 'Rate limit exceeded' ||
      message.length < 20;

    // OpenRouter may have raw upstream error in metadata
    if (isGenericMessage && metadata.raw) {
      const rawMsg = typeof metadata.raw === 'string' ? metadata.raw : JSON.stringify(metadata.raw);
      message = rawMsg.slice(0, 200);
    }

    // Check for upstream provider error details
    if (isGenericMessage && metadata.upstream_error) {
      message = String(metadata.upstream_error).slice(0, 200);
    }

    // Detect rate limit type from code or message
    let type = 'rate_limit';
    const lowerCode = String(code).toLowerCase();
    const lowerMessage = message.toLowerCase();

    if (lowerCode.includes('token') || lowerMessage.includes('token')) {
      type = 'tokens_limit';
    } else if (lowerCode.includes('request') || lowerMessage.includes('requests')) {
      type = 'requests_limit';
    } else if (lowerMessage.includes('credit') || lowerMessage.includes('quota')) {
      type = 'credits_exhausted';
    } else if (metadata.provider_name) {
      // OpenRouter passes through upstream provider info
      type = `provider_${metadata.provider_name}`;
    }

    // Truncate message for logging (max 150 chars)
    const truncatedMessage = message.length > 150 ? message.slice(0, 150) + '...' : message;

    // Include raw snippet when message is still generic for debugging
    const result: RateLimitDetails = {
      type,
      message: truncatedMessage,
      reason: `429 ${type}: ${truncatedMessage}`,
    };

    // Add raw snippet for debugging when message is unhelpful
    if (truncatedMessage === 'Provider returned error' || truncatedMessage.length < 20) {
      result.rawSnippet = responseBody.slice(0, 300);
    }

    return result;
  } catch {
    // Not JSON or parse failed - use raw body snippet
    const snippet = responseBody.slice(0, 100);
    return {
      type: 'unknown',
      message: snippet,
      reason: `429 rate limited: ${snippet}`,
    };
  }
}

interface ErrorDetails {
  message: string; // parsed error message
  rawSnippet?: string; // raw response for debugging
}

/**
 * Parse error details from provider error response body.
 * Used for non-429 errors (400, 500, etc.)
 */
function parseErrorDetails(responseBody: string): ErrorDetails {
  if (!responseBody) {
    return { message: '' };
  }

  try {
    const parsed = JSON.parse(responseBody);
    const error = parsed.error || parsed;
    let message = error.message || '';
    const metadata = error.metadata || {};

    // Try to get more details from metadata if message is generic
    if (!message || message === 'Provider returned error' || message.length < 15) {
      if (metadata.raw) {
        const rawMsg = typeof metadata.raw === 'string' ? metadata.raw : JSON.stringify(metadata.raw);
        message = rawMsg.slice(0, 200);
      } else if (metadata.upstream_error) {
        message = String(metadata.upstream_error).slice(0, 200);
      }
    }

    // Truncate message for logging (max 200 chars)
    const truncatedMessage = message.length > 200 ? message.slice(0, 200) + '...' : message;

    const result: ErrorDetails = { message: truncatedMessage };

    // Add raw snippet when message is still unhelpful
    if (!truncatedMessage || truncatedMessage === 'Provider returned error' || truncatedMessage.length < 15) {
      result.rawSnippet = responseBody.slice(0, 300);
    }

    return result;
  } catch {
    // Not JSON - return raw snippet
    return {
      message: responseBody.slice(0, 100),
      rawSnippet: responseBody.slice(0, 300),
    };
  }
}

/**
 * Execute a chain: iterate entries in order, skip exhausted providers,
 * waterfall on any failure, return first success.
 *
 * @param chain - The chain to execute (ordered list of provider+model entries).
 * @param request - The incoming chat completion request.
 * @param tracker - Rate limit tracker to check/update provider state.
 * @param registry - Provider adapter registry.
 * @param globalTimeoutMs - Global timeout in milliseconds (default for providers without per-provider timeout).
 * @returns The successful chain result including response and metadata.
 * @throws AllProvidersExhaustedError when all entries fail or are skipped.
 */
export async function executeChain(
  chain: Chain,
  request: ChatCompletionRequest,
  tracker: RateLimitTracker,
  registry: ProviderRegistry,
  globalTimeoutMs: number,
): Promise<ChainResult> {
  const attempts: AttemptRecord[] = [];

  for (let i = 0; i < chain.entries.length; i++) {
    const entry = chain.entries[i]!;

    // Find next non-exhausted entry for log context (best-effort, don't pre-check all)
    const nextEntry = chain.entries[i + 1];
    const nextHint = nextEntry
      ? ` -> next: ${nextEntry.providerId}/${nextEntry.model}`
      : ' -> no more providers';

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

    // Create timeout signal (per-provider timeout overrides global)
    const timeoutMs = adapter.timeout ?? globalTimeoutMs;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);

    try {
      const result = await adapter.chatCompletion(entry.model, request, timeoutSignal);

      const latencyMs = performance.now() - attemptStart;

      // Parse rate limit headers from successful response and update quota tracking
      const rateLimitInfo = adapter.parseRateLimitHeaders(result.headers);
      if (rateLimitInfo) {
        tracker.updateQuota(entry.providerId, entry.model, rateLimitInfo);
      } else if (tracker.hasManualLimits(entry.providerId, entry.model)) {
        // No headers from provider -- fall back to manual limit tracking
        tracker.recordRequest(entry.providerId, entry.model);
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
          const seconds = parseFloat(retryAfterHeader);
          if (!isNaN(seconds)) {
            retryAfterMs = seconds * 1000;
          }
        }

        // Parse rate limit details from provider response
        const rateLimitDetails = parseRateLimitDetails(error.responseBody);

        tracker.markExhausted(
          entry.providerId,
          entry.model,
          retryAfterMs,
          rateLimitDetails.reason,
        );

        logger.info(
          {
            provider: entry.providerId,
            model: entry.model,
            chain: chain.name,
            latencyMs: Math.round(latencyMs),
            retryAfterMs,
            rateLimitType: rateLimitDetails.type,
            rateLimitMessage: rateLimitDetails.message,
            ...(rateLimitDetails.rawSnippet && { rawResponse: rateLimitDetails.rawSnippet }),
            next: nextEntry ? `${nextEntry.providerId}/${nextEntry.model}` : null,
          },
          `Provider ${entry.providerId}/${entry.model} returned 429 (${rateLimitDetails.type}), waterfalling${nextHint}`,
        );

        attempts.push({
          provider: entry.providerId,
          model: entry.model,
          error: `429_${rateLimitDetails.type}`,
          retryAfter: retryAfterMs,
        });
        continue;
      }

      if (error instanceof ProviderError) {
        // 402 Payment Required: credit exhaustion — apply long cooldown
        if (error.statusCode === 402) {
          tracker.markExhausted(
            entry.providerId,
            entry.model,
            300_000, // 5 minutes — credits won't recover quickly
            '402 payment required (credits exhausted)',
          );
        }

        // Parse error details from response body
        const errorDetails = parseErrorDetails(error.responseBody);

        // Non-429 provider error (5xx, 402, etc.): waterfall to next
        logger.info(
          {
            provider: entry.providerId,
            model: entry.model,
            chain: chain.name,
            statusCode: error.statusCode,
            errorMessage: errorDetails.message,
            ...(errorDetails.rawSnippet && { rawResponse: errorDetails.rawSnippet }),
            latencyMs: Math.round(latencyMs),
            next: nextEntry ? `${nextEntry.providerId}/${nextEntry.model}` : null,
          },
          `Provider ${entry.providerId}/${entry.model} returned ${error.statusCode}, waterfalling${nextHint}`,
        );

        attempts.push({
          provider: entry.providerId,
          model: entry.model,
          error: `${error.statusCode}: ${errorDetails.message || error.message}`,
        });
        continue;
      }

      // Timeout: waterfall WITHOUT cooldown (transient, not a rate limit)
      if (error instanceof Error && error.name === 'TimeoutError') {
        const timeoutMs = adapter.timeout ?? globalTimeoutMs;
        logger.info(
          {
            provider: entry.providerId,
            model: entry.model,
            chain: chain.name,
            timeoutMs,
            latencyMs: Math.round(latencyMs),
            next: nextEntry ? `${nextEntry.providerId}/${nextEntry.model}` : null,
          },
          `Provider ${entry.providerId}/${entry.model} timed out after ${timeoutMs}ms, waterfalling (no cooldown)${nextHint}`,
        );

        attempts.push({
          provider: entry.providerId,
          model: entry.model,
          error: `timeout_${timeoutMs}ms`,
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
          next: nextEntry ? `${nextEntry.providerId}/${nextEntry.model}` : null,
        },
        `Provider ${entry.providerId}/${entry.model} failed: ${errorMessage}, waterfalling${nextHint}`,
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
  globalTimeoutMs?: number,
): Promise<StreamChainResult> {
  const attempts: AttemptRecord[] = [];

  for (let i = 0; i < chain.entries.length; i++) {
    const entry = chain.entries[i]!;

    // Find next non-exhausted entry for log context (best-effort, don't pre-check all)
    const nextEntry = chain.entries[i + 1];
    const nextHint = nextEntry
      ? ` -> next: ${nextEntry.providerId}/${nextEntry.model}`
      : ' -> no more providers';

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

    // Create connection-only timeout: clears once the stream opens.
    // The per-chunk idle timeout in the relay loop takes over for body streaming.
    const timeoutMs = adapter.timeout ?? globalTimeoutMs;
    const connectionAbort = new AbortController();
    let connectionTimer: ReturnType<typeof setTimeout> | null = null;
    if (timeoutMs) {
      connectionTimer = setTimeout(() => {
        connectionAbort.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
      }, timeoutMs);
    }

    const effectiveSignal = signal
      ? AbortSignal.any([connectionAbort.signal, signal])
      : connectionAbort.signal;

    try {
      const response = await adapter.chatCompletionStream(entry.model, request, effectiveSignal);

      // Stream opened — clear the connection timeout so it doesn't kill body streaming
      if (connectionTimer) clearTimeout(connectionTimer);

      // Parse rate limit headers from streaming response (headers available before body consumed)
      const rateLimitInfo = adapter.parseRateLimitHeaders(response.headers);
      if (rateLimitInfo) {
        tracker.updateQuota(entry.providerId, entry.model, rateLimitInfo);
      } else if (tracker.hasManualLimits(entry.providerId, entry.model)) {
        tracker.recordRequest(entry.providerId, entry.model);
      }

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
      if (connectionTimer) clearTimeout(connectionTimer);
      // Timeout: waterfall WITHOUT cooldown (must check BEFORE AbortError)
      if (error instanceof Error && error.name === 'TimeoutError') {
        const timeoutMs = adapter.timeout ?? globalTimeoutMs;
        logger.info(
          {
            provider: entry.providerId,
            model: entry.model,
            chain: chain.name,
            timeoutMs,
            next: nextEntry ? `${nextEntry.providerId}/${nextEntry.model}` : null,
          },
          `Provider ${entry.providerId}/${entry.model} timed out [stream], waterfalling (no cooldown)${nextHint}`,
        );
        attempts.push({
          provider: entry.providerId,
          model: entry.model,
          error: `timeout_${timeoutMs}ms`,
        });
        continue;
      }

      if (error instanceof ProviderRateLimitError) {
        const retryAfterHeader = error.headers.get('retry-after');
        let retryAfterMs: number | undefined;
        if (retryAfterHeader) {
          const seconds = parseFloat(retryAfterHeader);
          if (!isNaN(seconds)) {
            retryAfterMs = seconds * 1000;
          }
        }

        // Parse rate limit details from provider response
        const rateLimitDetails = parseRateLimitDetails(error.responseBody);

        tracker.markExhausted(
          entry.providerId,
          entry.model,
          retryAfterMs,
          rateLimitDetails.reason,
        );

        logger.info(
          {
            provider: entry.providerId,
            model: entry.model,
            chain: chain.name,
            retryAfterMs,
            rateLimitType: rateLimitDetails.type,
            rateLimitMessage: rateLimitDetails.message,
            ...(rateLimitDetails.rawSnippet && { rawResponse: rateLimitDetails.rawSnippet }),
            next: nextEntry ? `${nextEntry.providerId}/${nextEntry.model}` : null,
          },
          `Provider ${entry.providerId}/${entry.model} returned 429 [stream] (${rateLimitDetails.type}), waterfalling${nextHint}`,
        );

        attempts.push({
          provider: entry.providerId,
          model: entry.model,
          error: `429_${rateLimitDetails.type}`,
          retryAfter: retryAfterMs,
        });
        continue;
      }

      if (error instanceof ProviderError) {
        // 402 Payment Required: credit exhaustion — apply long cooldown
        if (error.statusCode === 402) {
          tracker.markExhausted(
            entry.providerId,
            entry.model,
            300_000, // 5 minutes — credits won't recover quickly
            '402 payment required (credits exhausted)',
          );
        }

        // Parse error details from response body
        const errorDetails = parseErrorDetails(error.responseBody);

        logger.info(
          {
            provider: entry.providerId,
            model: entry.model,
            chain: chain.name,
            statusCode: error.statusCode,
            errorMessage: errorDetails.message,
            ...(errorDetails.rawSnippet && { rawResponse: errorDetails.rawSnippet }),
            next: nextEntry ? `${nextEntry.providerId}/${nextEntry.model}` : null,
          },
          `Provider ${entry.providerId}/${entry.model} returned ${error.statusCode} [stream], waterfalling${nextHint}`,
        );
        attempts.push({
          provider: entry.providerId,
          model: entry.model,
          error: `${error.statusCode}: ${errorDetails.message || error.message}`,
        });
        continue;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);

      // If this is an AbortError, the client disconnected -- don't waterfall, just throw
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }

      logger.info(
        {
          provider: entry.providerId,
          model: entry.model,
          chain: chain.name,
          error: errorMessage,
          next: nextEntry ? `${nextEntry.providerId}/${nextEntry.model}` : null,
        },
        `Provider ${entry.providerId}/${entry.model} failed [stream]: ${errorMessage}, waterfalling${nextHint}`,
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
