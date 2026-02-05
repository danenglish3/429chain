/**
 * GET /v1/models handler.
 * Returns available models from all configured chains in OpenAI list format.
 */

import { Hono } from 'hono';
import type { Chain } from '../../chain/types.js';

/**
 * Create models routes with injected dependencies.
 * @param chains - Map of chain name to Chain object.
 * @returns Hono app with GET /models route.
 */
export function createModelsRoutes(chains: Map<string, Chain>) {
  const app = new Hono();

  app.get('/models', (c) => {
    // Collect unique provider+model pairs from all chain entries
    const seen = new Set<string>();
    const data: Array<{
      id: string;
      object: 'model';
      created: number;
      owned_by: string;
    }> = [];

    const now = Math.floor(Date.now() / 1000);

    for (const chain of chains.values()) {
      for (const entry of chain.entries) {
        // Deduplicate by model ID
        if (!seen.has(entry.model)) {
          seen.add(entry.model);
          data.push({
            id: entry.model,
            object: 'model',
            created: now,
            owned_by: entry.providerId,
          });
        }
      }
    }

    return c.json({
      object: 'list' as const,
      data,
    });
  });

  return app;
}
