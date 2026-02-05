/**
 * Custom error classes for the 429chain proxy.
 * All errors are designed to produce OpenAI-compatible error responses.
 */

import type { AttemptRecord, OpenAIErrorResponse } from './types.js';

/** Error thrown when config validation or loading fails. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Generic provider failure error. */
export class ProviderError extends Error {
  public readonly providerId: string;
  public readonly model: string;
  public readonly statusCode: number;
  public readonly responseBody: string;

  constructor(providerId: string, model: string, statusCode: number, responseBody: string) {
    super(`Provider ${providerId} returned ${statusCode} for model ${model}`);
    this.name = 'ProviderError';
    this.providerId = providerId;
    this.model = model;
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

/** Specifically a 429 rate limit error from a provider. */
export class ProviderRateLimitError extends ProviderError {
  public readonly headers: Headers;

  constructor(providerId: string, model: string, headers: Headers, responseBody: string = '') {
    super(providerId, model, 429, responseBody);
    this.name = 'ProviderRateLimitError';
    this.headers = headers;
  }
}

/** Thrown when all providers in a chain have been tried and failed. */
export class AllProvidersExhaustedError extends Error {
  public readonly attempts: AttemptRecord[];

  constructor(chainName: string, attempts: AttemptRecord[]) {
    const summary = attempts
      .map((a) => {
        const status = a.skipped ? 'skipped (on cooldown)' : a.error;
        return `${a.provider}/${a.model} (${status})`;
      })
      .join(', ');

    super(`All providers exhausted in chain "${chainName}". Tried: ${summary}`);
    this.name = 'AllProvidersExhaustedError';
    this.attempts = attempts;
  }

  /** Build an OpenAI-compatible error response. */
  toOpenAIError(): OpenAIErrorResponse {
    return {
      error: {
        message: this.message,
        type: 'server_error',
        param: null,
        code: 'all_providers_exhausted',
      },
    };
  }
}
