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
import { RequestLogger } from '../../persistence/request-logger.js';
import { normalizeResponse, normalizeChunk } from '../../shared/normalize.js';
import type { Chain, StreamChainResult } from '../../chain/types.js';
import type { RateLimitTracker } from '../../ratelimit/tracker.js';
import type { ProviderRegistry } from '../../providers/types.js';
import type { ChatCompletionRequest, Usage } from '../../shared/types.js';

/**
 * Create chat completion routes with injected dependencies.
 * @param chains - Map of chain name to Chain object.
 * @param tracker - Rate limit tracker instance.
 * @param registry - Provider adapter registry.
 * @param defaultChainName - Default chain name from config.
 * @param requestLogger - Request logger for observability.
 * @param globalTimeoutMs - Global timeout in milliseconds for upstream requests.
 * @param normalizeResponses - If true, move reasoning_content to content for reasoning models.
 * @returns Hono app with POST /chat/completions route.
 */
export function createChatRoutes(
  chains: Map<string, Chain>,
  tracker: RateLimitTracker,
  registry: ProviderRegistry,
  defaultChainName: string,
  requestLogger: RequestLogger,
  globalTimeoutMs: number,
  normalizeResponses: boolean,
) {
  const app = new Hono();

  app.post('/chat/completions', async (c) => {
    const body = await c.req.json<ChatCompletionRequest>();

    // Use model field as chain name hint; fall back to default
    const requestedModel = body.model;
    const chainName = chains.has(requestedModel) ? requestedModel : undefined;

    const chain = resolveChain(chainName, chains, defaultChainName);

    logger.info(
      { requestedModel, chain: chain.name, stream: !!body.stream },
      `Chat completion request (model="${requestedModel}" -> chain="${chain.name}"${body.stream ? ', streaming' : ''})`,
    );

    // Streaming branch
    if (body.stream) {
      // Strip model field (chain entry determines actual model)
      // Inject stream_options to capture token usage in final chunk
      const { model: _model, ...streamBody } = body;
      const streamRequest = {
        ...streamBody,
        stream_options: { include_usage: true },
      } as unknown as ChatCompletionRequest;

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
          streamRequest,
          tracker,
          registry,
          abortController.signal,
          globalTimeoutMs,
        );
      } catch (error) {
        if (error instanceof AllProvidersExhaustedError) {
          // Log the failed request so it appears in the dashboard
          const lastAttempt = error.attempts[error.attempts.length - 1];
          setImmediate(() => {
            try {
              requestLogger.logRequest({
                timestamp: Date.now(),
                chainName: chain.name,
                providerId: lastAttempt?.provider ?? 'unknown',
                model: lastAttempt?.model ?? requestedModel,
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                latencyMs: 0,
                httpStatus: 503,
                attempts: error.attempts.length,
                errorMessage: error.message,
              });
            } catch (logError) {
              logger.error({ error: logError }, 'Failed to log exhausted request');
            }
          });
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

        let capturedUsage: Usage | null = null;
        const streamStart = performance.now();

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
              // Check if this chunk contains usage data (final chunk from OpenAI)
              try {
                const parsed = JSON.parse(data);
                if (parsed.usage && typeof parsed.usage.total_tokens === 'number') {
                  capturedUsage = parsed.usage as Usage;
                }
              } catch {
                // Not JSON or doesn't have usage -- normal content chunk, continue
              }

              // Apply normalization if enabled (after usage capture)
              const normalizedData = normalizeResponses ? normalizeChunk(data) : data;
              await stream.writeSSE({ data: normalizedData });
            }

            if (result.done) {
              // Write the final [DONE] marker to the client
              await stream.writeSSE({ data: '[DONE]' });

              // Reset mid-stream failure counter on successful completion
              tracker.resetMidStreamFailures(streamResult.providerId, streamResult.model);

              // Fire-and-forget: log streaming request with captured usage
              const streamLatencyMs = performance.now() - streamStart;
              setImmediate(() => {
                try {
                  requestLogger.logRequest({
                    timestamp: Date.now(),
                    chainName: chain.name,
                    providerId: streamResult.providerId,
                    model: streamResult.model,
                    promptTokens: capturedUsage?.prompt_tokens ?? 0,
                    completionTokens: capturedUsage?.completion_tokens ?? 0,
                    totalTokens: capturedUsage?.total_tokens ?? 0,
                    latencyMs: streamLatencyMs,
                    httpStatus: 200,
                    attempts: streamResult.attempts.length + 1,
                  });
                } catch (error) {
                  logger.error({ error }, 'Failed to log streaming request');
                }
              });

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
          const streamLatencyMs = performance.now() - streamStart;
          logger.error(
            {
              provider: streamResult.providerId,
              model: streamResult.model,
              chain: chain.name,
              error: errorMessage,
              latencyMs: Math.round(streamLatencyMs),
            },
            `Mid-stream error from ${streamResult.providerId}/${streamResult.model}: ${errorMessage} (stream will close, client must retry)`,
          );

          // Record mid-stream failure for cooldown tracking
          tracker.recordMidStreamFailure(streamResult.providerId, streamResult.model);

          // Log the failed streaming request so it appears in the dashboard
          setImmediate(() => {
            try {
              requestLogger.logRequest({
                timestamp: Date.now(),
                chainName: chain.name,
                providerId: streamResult.providerId,
                model: streamResult.model,
                promptTokens: capturedUsage?.prompt_tokens ?? 0,
                completionTokens: capturedUsage?.completion_tokens ?? 0,
                totalTokens: capturedUsage?.total_tokens ?? 0,
                latencyMs: streamLatencyMs,
                httpStatus: 502,
                attempts: streamResult.attempts.length + 1,
                errorMessage,
              });
            } catch (logError) {
              logger.error({ error: logError }, 'Failed to log mid-stream error request');
            }
          });

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

    let result;
    try {
      result = await executeChain(
        chain,
        cleanBody as ChatCompletionRequest,
        tracker,
        registry,
        globalTimeoutMs,
      );
    } catch (error) {
      if (error instanceof AllProvidersExhaustedError) {
        const lastAttempt = error.attempts[error.attempts.length - 1];
        setImmediate(() => {
          try {
            requestLogger.logRequest({
              timestamp: Date.now(),
              chainName: chain.name,
              providerId: lastAttempt?.provider ?? 'unknown',
              model: lastAttempt?.model ?? requestedModel,
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
              latencyMs: 0,
              httpStatus: 502,
              attempts: error.attempts.length,
              errorMessage: error.message,
            });
          } catch (logError) {
            logger.error({ error: logError }, 'Failed to log exhausted request');
          }
        });
      }
      throw error;
    }

    // Set informational headers
    c.header('X-429chain-Provider', `${result.providerId}/${result.model}`);
    c.header('X-429chain-Attempts', String(result.attempts.length + 1));

    // Fire-and-forget: log request without blocking response
    setImmediate(() => {
      try {
        requestLogger.logRequest({
          timestamp: Date.now(),
          chainName: chain.name,
          providerId: result.providerId,
          model: result.model,
          promptTokens: result.response.usage.prompt_tokens,
          completionTokens: result.response.usage.completion_tokens,
          totalTokens: result.response.usage.total_tokens,
          latencyMs: result.latencyMs,
          httpStatus: 200,
          attempts: result.attempts.length + 1,
        });
      } catch (error) {
        logger.error({ error }, 'Failed to log request');
      }
    });

    // Apply normalization if enabled
    if (normalizeResponses) {
      normalizeResponse(result.response);
    }

    return c.json(result.response);
  });

  return app;
}
