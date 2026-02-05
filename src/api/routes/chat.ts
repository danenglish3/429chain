/**
 * POST /v1/chat/completions handler.
 * Receives OpenAI-compatible chat completion requests, resolves the
 * appropriate chain, executes the waterfall, and returns the response.
 */

import { Hono } from 'hono';
import { logger } from '../../shared/logger.js';
import { executeChain, resolveChain } from '../../chain/router.js';
import type { Chain } from '../../chain/types.js';
import type { RateLimitTracker } from '../../ratelimit/tracker.js';
import type { ProviderRegistry } from '../../providers/types.js';
import type { ChatCompletionRequest } from '../../shared/types.js';

/**
 * Create chat completion routes with injected dependencies.
 * @param chains - Map of chain name to Chain object.
 * @param tracker - Rate limit tracker instance.
 * @param registry - Provider adapter registry.
 * @param defaultChainName - Default chain name from config.
 * @returns Hono app with POST /chat/completions route.
 */
export function createChatRoutes(
  chains: Map<string, Chain>,
  tracker: RateLimitTracker,
  registry: ProviderRegistry,
  defaultChainName: string,
) {
  const app = new Hono();

  app.post('/chat/completions', async (c) => {
    const body = await c.req.json<ChatCompletionRequest>();

    // Use model field as chain name hint; fall back to default
    const requestedModel = body.model;
    const chainName = chains.has(requestedModel) ? requestedModel : undefined;

    const chain = resolveChain(chainName, chains, defaultChainName);

    logger.info(
      { requestedModel, chain: chain.name },
      `Chat completion request using chain "${chain.name}"`,
    );

    // Strip model from the body (the chain entry determines the actual model)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { model: _model, stream: _stream, ...cleanBody } = body;

    if (body.stream) {
      logger.warn('Streaming not yet supported, falling back to non-streaming');
    }

    const result = await executeChain(
      chain,
      cleanBody as ChatCompletionRequest,
      tracker,
      registry,
    );

    // Set informational headers
    c.header('X-429chain-Provider', `${result.providerId}/${result.model}`);
    c.header('X-429chain-Attempts', String(result.attempts.length + 1));

    return c.json(result.response);
  });

  return app;
}
