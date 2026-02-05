/**
 * Global error handler returning OpenAI-format errors.
 * Catches all errors from route handlers and converts them to
 * standard OpenAI error response format.
 */

import type { ErrorHandler } from 'hono';
import { logger } from '../../shared/logger.js';
import {
  AllProvidersExhaustedError,
  ProviderRateLimitError,
  ConfigError,
} from '../../shared/errors.js';

/**
 * Hono error handler that converts all error types to OpenAI-format JSON responses.
 *
 * Error mapping:
 * - AllProvidersExhaustedError -> 502 (Bad Gateway) with detailed attempt listing
 * - ProviderRateLimitError -> 429 (defensive, normally caught by chain router)
 * - ConfigError -> 500 (no internal details exposed)
 * - Unknown -> 500 (generic server error)
 */
export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof AllProvidersExhaustedError) {
    logger.warn(
      { chain: err.message, attempts: err.attempts },
      'All providers exhausted',
    );
    return c.json(err.toOpenAIError(), 502);
  }

  if (err instanceof ProviderRateLimitError) {
    logger.warn(
      { provider: err.providerId, model: err.model },
      'Provider rate limited (unhandled by chain)',
    );
    return c.json(
      {
        error: {
          message: `Rate limited by provider ${err.providerId} for model ${err.model}.`,
          type: 'tokens_exceeded',
          param: null,
          code: 'rate_limit_exceeded',
        },
      },
      429,
    );
  }

  if (err instanceof ConfigError) {
    logger.error({ err }, 'Configuration error');
    return c.json(
      {
        error: {
          message: 'Internal configuration error',
          type: 'server_error',
          param: null,
          code: 'config_error',
        },
      },
      500,
    );
  }

  // Unknown error -- log full details but return generic message
  logger.error({ err }, 'Unhandled error');
  return c.json(
    {
      error: {
        message: 'Internal server error',
        type: 'server_error',
        param: null,
        code: null,
      },
    },
    500,
  );
};
