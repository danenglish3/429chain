/**
 * Abstract base adapter with shared HTTP request logic.
 * Concrete adapters extend this and implement provider-specific
 * header parsing and body preparation.
 */

import { logger } from '../shared/logger.js';
import { ProviderError, ProviderRateLimitError } from '../shared/errors.js';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../shared/types.js';
import type { ProviderAdapter, ProviderResponse, RateLimitInfo } from './types.js';

export abstract class BaseAdapter implements ProviderAdapter {
  public readonly id: string;
  public readonly providerType: string;
  public readonly name: string;
  public readonly baseUrl: string;
  protected readonly apiKey: string;
  public readonly timeout?: number;

  constructor(
    id: string,
    providerType: string,
    name: string,
    apiKey: string,
    baseUrl: string,
    timeout?: number,
  ) {
    this.id = id;
    this.providerType = providerType;
    this.name = name;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.timeout = timeout;
  }

  /**
   * Send a non-streaming chat completion request to the provider.
   * Handles URL construction, headers, latency measurement, and error detection.
   */
  async chatCompletion(
    model: string,
    body: ChatCompletionRequest,
    signal?: AbortSignal,
  ): Promise<ProviderResponse> {
    const url = `${this.baseUrl}/chat/completions`;
    const requestBody = this.prepareRequestBody(model, body);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      ...this.getExtraHeaders(),
    };

    logger.debug({ provider: this.id, model, url }, 'Sending chat completion request');

    const start = performance.now();

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal,
    });

    const latencyMs = Math.round(performance.now() - start);

    if (response.status === 429) {
      const responseBody = await response.text();
      logger.warn(
        { provider: this.id, model, latencyMs },
        'Provider returned 429 rate limit',
      );
      throw new ProviderRateLimitError(this.id, model, response.headers, responseBody);
    }

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { provider: this.id, model, status: response.status, latencyMs },
        'Provider returned error',
      );
      throw new ProviderError(this.id, model, response.status, errorText);
    }

    const responseBody = (await response.json()) as ChatCompletionResponse;

    logger.debug(
      { provider: this.id, model, status: response.status, latencyMs },
      'Chat completion succeeded',
    );

    return {
      status: response.status,
      body: responseBody,
      headers: response.headers,
      latencyMs,
    };
  }

  /**
   * Send a streaming chat completion request to the provider.
   * Returns the raw Response with ReadableStream body for SSE parsing.
   */
  async chatCompletionStream(
    model: string,
    body: ChatCompletionRequest,
    signal?: AbortSignal,
  ): Promise<Response> {
    const url = `${this.baseUrl}/chat/completions`;
    const requestBody = this.prepareRequestBody(model, body);
    requestBody.stream = true; // Override: force streaming

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      ...this.getExtraHeaders(),
    };

    logger.debug({ provider: this.id, model, url }, 'Starting streaming request');

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal,
    });

    if (response.status === 429) {
      const responseBody = await response.text();
      logger.warn(
        { provider: this.id, model },
        'Provider returned 429 rate limit (streaming)',
      );
      throw new ProviderRateLimitError(this.id, model, response.headers, responseBody);
    }

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { provider: this.id, model, status: response.status },
        'Streaming request failed',
      );
      throw new ProviderError(this.id, model, response.status, errorText);
    }

    return response;
  }

  /**
   * Prepare the request body for the provider.
   * Default: merge model into body and force stream: false.
   * Adapters can override to strip unsupported parameters.
   */
  protected prepareRequestBody(
    model: string,
    body: ChatCompletionRequest,
  ): Record<string, unknown> {
    // Destructure to omit the original model field and replace it
    const { model: _originalModel, ...rest } = body;
    return { ...rest, model, stream: false };
  }

  /**
   * Get provider-specific headers.
   * Default: no extra headers. Override in adapters that need them.
   */
  getExtraHeaders(): Record<string, string> {
    return {};
  }

  /**
   * Parse rate limit information from response headers.
   * Each adapter must implement this with provider-specific logic.
   */
  abstract parseRateLimitHeaders(headers: Headers): RateLimitInfo | null;
}
