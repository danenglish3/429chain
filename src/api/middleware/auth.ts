/**
 * API key validation middleware for Hono.
 * Validates Bearer token in Authorization header against configured API keys.
 * Returns OpenAI-format 401 errors for missing or invalid keys.
 */

import { createMiddleware } from 'hono/factory';

/**
 * Create an auth middleware that validates API keys from the Authorization header.
 * @param apiKeys - Array of valid API keys from config.
 * @returns Hono middleware that enforces API key authentication.
 */
export function createAuthMiddleware(apiKeys: string[]) {
  const keySet = new Set(apiKeys);

  return createMiddleware(async (c, next) => {
    const authorization = c.req.header('authorization');

    if (!authorization || !authorization.startsWith('Bearer ')) {
      return c.json(
        {
          error: {
            message:
              'Missing or invalid API key. Provide a valid key in the Authorization header as Bearer <key>.',
            type: 'invalid_request_error',
            param: null,
            code: 'invalid_api_key',
          },
        },
        401,
      );
    }

    const key = authorization.slice('Bearer '.length);

    if (!keySet.has(key)) {
      return c.json(
        {
          error: {
            message: 'Invalid API key provided.',
            type: 'invalid_request_error',
            param: null,
            code: 'invalid_api_key',
          },
        },
        401,
      );
    }

    await next();
  });
}
