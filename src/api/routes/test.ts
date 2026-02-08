/**
 * POST /v1/test/chain/:name handler.
 * Tests each entry in a chain individually (not waterfall).
 */

import { Hono } from 'hono';
import { logger } from '../../shared/logger.js';
import type { Chain } from '../../chain/types.js';
import type { ProviderRegistry } from '../../providers/types.js';
import type { ChatCompletionRequest } from '../../shared/types.js';

interface TestEntryResult {
  provider: string;
  model: string;
  status: 'ok' | 'error';
  latencyMs: number;
  response?: string;
  tokens?: { prompt: number; completion: number; total: number };
  error?: string;
  raw?: unknown;
}

export function createTestRoutes(
  chains: Map<string, Chain>,
  registry: ProviderRegistry,
  globalTimeoutMs: number,
) {
  const app = new Hono();

  app.post('/chain/:name', async (c) => {
    const chainName = c.req.param('name');
    const chain = chains.get(chainName);

    if (!chain) {
      return c.json({ error: `Chain "${chainName}" not found` }, 404);
    }

    // Parse optional prompt from body (may be empty body)
    let prompt = 'Say hello in one word.';
    try {
      const body = await c.req.json();
      if (body?.prompt && typeof body.prompt === 'string') {
        prompt = body.prompt;
      }
    } catch {
      // Empty body or invalid JSON — use default prompt
    }

    const testRequest: ChatCompletionRequest = {
      model: '', // overridden per-entry
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 50,
      stream: false,
    };

    logger.info({ chain: chainName, entries: chain.entries.length }, `Chain walk test: "${chainName}"`);

    const results: TestEntryResult[] = [];

    // Test each entry sequentially (NOT waterfall — test every entry)
    for (const entry of chain.entries) {
      const adapter = registry.get(entry.providerId);
      const timeoutMs = adapter.timeout ?? globalTimeoutMs;
      const startTime = performance.now();

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const providerResponse = await adapter.chatCompletion(
          entry.model,
          testRequest,
          controller.signal,
        );

        clearTimeout(timer);

        const latencyMs = Math.round(performance.now() - startTime);
        const message = providerResponse.body.choices[0]?.message;
        // Some models (e.g. DeepSeek R1) put output in reasoning_content instead of content
        const content = message?.content
          || (message as Record<string, unknown>)?.reasoning_content as string
          || '';

        results.push({
          provider: entry.providerId,
          model: entry.model,
          status: 'ok',
          latencyMs,
          response: content.length > 200 ? content.slice(0, 200) + '...' : content,
          tokens: {
            prompt: providerResponse.body.usage?.prompt_tokens ?? 0,
            completion: providerResponse.body.usage?.completion_tokens ?? 0,
            total: providerResponse.body.usage?.total_tokens ?? 0,
          },
          raw: providerResponse.body,
        });
      } catch (err: unknown) {
        const latencyMs = Math.round(performance.now() - startTime);
        const errorMessage = err instanceof Error ? err.message : String(err);

        results.push({
          provider: entry.providerId,
          model: entry.model,
          status: 'error',
          latencyMs,
          error: errorMessage,
        });
      }
    }

    const okCount = results.filter((r) => r.status === 'ok').length;

    return c.json({
      chain: chainName,
      results,
      summary: {
        total: results.length,
        ok: okCount,
        failed: results.length - okCount,
      },
    });
  });

  return app;
}
