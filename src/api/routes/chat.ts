/**
 * POST /v1/chat/completions handler.
 * Receives OpenAI-compatible chat completion requests, resolves the
 * appropriate chain, executes the waterfall, and returns the response.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { logger } from '../../shared/logger.js';
import { executeChain, executeStreamChain, resolveChain } from '../../chain/router.js';
import { AllProvidersExhaustedError } from '../../shared/errors.js';
import { createSSEParser } from '../../streaming/sse-parser.js';
import type { Chain, StreamChainResult } from '../../chain/types.js';
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

    // Streaming branch
    if (body.stream) {
      // Strip model field (chain entry determines actual model)
      const { model: _model, ...streamBody } = body;

      // Create AbortController for upstream cleanup
      const abortController = new AbortController();

      // Pre-stream waterfall: find available provider and open stream
      // This happens BEFORE streamSSE() -- if all exhausted, return JSON error
      //
      // NOTE: Using definite assignment assertion (!) because the catch block
      // always exits (return or throw), guaranteeing streamResult is assigned
      // after the try-catch. TypeScript cannot statically verify this pattern.
      let streamResult!: StreamChainResult;
      try {
        streamResult = await executeStreamChain(
          chain,
          streamBody as ChatCompletionRequest,
          tracker,
          registry,
          abortController.signal,
        );
      } catch (error) {
        if (error instanceof AllProvidersExhaustedError) {
          return c.json(error.toOpenAIError(), 503);
        }
        throw error;
      }

      // Set informational headers
      c.header('X-429chain-Provider', `${streamResult.providerId}/${streamResult.model}`);
      c.header('X-429chain-Attempts', String(streamResult.attempts.length + 1));

      // Now open SSE stream to client
      return streamSSE(c, async (stream) => {
        // Wire cleanup: when client disconnects, abort the upstream fetch
        stream.onAbort(() => {
          logger.debug(
            { provider: streamResult.providerId, model: streamResult.model },
            'Client disconnected, aborting upstream stream',
          );
          abortController.abort();
        });

        try {
          const reader = streamResult.response.body!.getReader();
          const decoder = new TextDecoder();
          const parser = createSSEParser();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const result = parser.parse(chunk);

            for (const data of result.events) {
              await stream.writeSSE({ data });
            }

            if (result.done) {
              // Write the final [DONE] marker to the client
              await stream.writeSSE({ data: '[DONE]' });
              break;
            }
          }
        } catch (error: unknown) {
          if (error instanceof Error && error.name === 'AbortError') {
            // Client disconnected -- clean exit, no error logging
            logger.debug(
              { provider: streamResult.providerId, model: streamResult.model },
              'Upstream stream aborted (client disconnect)',
            );
            return;
          }

          // Real error during streaming -- send error event to client
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(
            { provider: streamResult.providerId, model: streamResult.model, error: errorMessage },
            'Mid-stream error',
          );

          try {
            await stream.writeSSE({
              event: 'error',
              data: JSON.stringify({
                error: {
                  message: `Stream error from provider: ${errorMessage}`,
                  type: 'server_error',
                  code: 'stream_error',
                },
              }),
            });
          } catch {
            // If we can't even write the error event, client is gone -- nothing to do
          }
        }
      });
    }

    // Non-streaming path
    const { model: _model, stream: _stream, ...cleanBody } = body;

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
