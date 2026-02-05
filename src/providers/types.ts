/**
 * Core provider adapter types.
 * Defines the uniform interface that all provider adapters implement,
 * plus normalized response and rate limit info types.
 */

import type { ChatCompletionRequest, ChatCompletionResponse } from '../shared/types.js';

/** Normalized rate limit information from any provider's response headers. */
export interface RateLimitInfo {
  /** Maximum requests allowed in the rate limit window. */
  limitRequests?: number;
  /** Requests remaining in the current window. */
  remainingRequests?: number;
  /** Milliseconds until the request limit resets. */
  resetRequestsMs?: number;
  /** Maximum tokens allowed in the rate limit window. */
  limitTokens?: number;
  /** Tokens remaining in the current window. */
  remainingTokens?: number;
  /** Milliseconds until the token limit resets. */
  resetTokensMs?: number;
  /** Explicit retry-after from a 429 response, in milliseconds. */
  retryAfterMs?: number;
}

/** Normalized response from a provider's chat completion endpoint. */
export interface ProviderResponse {
  /** HTTP status code from the provider. */
  status: number;
  /** Parsed chat completion response body. */
  body: ChatCompletionResponse;
  /** Raw response headers (for rate limit parsing). */
  headers: Headers;
  /** Time taken for the request in milliseconds. */
  latencyMs: number;
}

/**
 * Uniform interface for all provider adapters.
 * The chain router and registry work exclusively through this interface,
 * never with concrete provider implementations.
 */
export interface ProviderAdapter {
  /** Unique provider instance ID from config. */
  readonly id: string;
  /** Provider type discriminator (e.g., 'openrouter', 'groq', 'cerebras'). */
  readonly providerType: string;
  /** Human-readable display name. */
  readonly name: string;
  /** API base URL for this provider. */
  readonly baseUrl: string;

  /**
   * Send a non-streaming chat completion request.
   * @param model - The model ID to request.
   * @param body - The chat completion request body (model field is overridden).
   * @param signal - Optional AbortSignal for request cancellation.
   * @returns Normalized provider response.
   * @throws ProviderRateLimitError on 429 responses.
   * @throws ProviderError on other non-OK responses.
   */
  chatCompletion(
    model: string,
    body: ChatCompletionRequest,
    signal?: AbortSignal,
  ): Promise<ProviderResponse>;

  /**
   * Send a streaming chat completion request.
   * Returns the raw fetch Response so the caller can read the ReadableStream body.
   * @param model - The model ID to request.
   * @param body - The chat completion request body (model field is overridden).
   * @param signal - Optional AbortSignal for request cancellation (critical for cleanup).
   * @returns Raw fetch Response with body as ReadableStream of SSE chunks.
   * @throws ProviderRateLimitError on 429 responses (before stream starts).
   * @throws ProviderError on other non-OK responses.
   */
  chatCompletionStream(
    model: string,
    body: ChatCompletionRequest,
    signal?: AbortSignal,
  ): Promise<Response>;

  /**
   * Parse rate limit information from the provider's response headers.
   * Each provider has its own header format; this normalizes them.
   * @param headers - Raw response headers from the provider.
   * @returns Normalized rate limit info, or null if no rate limit headers present.
   */
  parseRateLimitHeaders(headers: Headers): RateLimitInfo | null;

  /**
   * Get provider-specific headers to include with every request.
   * For example, OpenRouter requires HTTP-Referer and X-Title.
   * @returns Record of header name to value.
   */
  getExtraHeaders(): Record<string, string>;
}

/**
 * Registry of provider adapters, keyed by provider instance ID.
 * The chain router uses this to look up adapters during waterfall execution.
 */
export interface ProviderRegistry {
  /**
   * Get a provider adapter by its instance ID.
   * @param providerId - Provider instance ID from config.
   * @returns The provider adapter.
   * @throws Error if the provider ID is not registered.
   */
  get(providerId: string): ProviderAdapter;

  /**
   * Check if a provider ID is registered.
   * @param providerId - Provider instance ID to check.
   */
  has(providerId: string): boolean;

  /**
   * Get all registered provider adapters.
   */
  getAll(): ProviderAdapter[];

  /**
   * Number of registered providers.
   */
  readonly size: number;
}
