/**
 * GET /health handler.
 * Returns proxy status information. No authentication required.
 */

import { Hono } from 'hono';
import type { Chain } from '../../chain/types.js';
import type { ProviderRegistry } from '../../providers/types.js';

/**
 * Create health routes with injected dependencies.
 * @param registry - Provider adapter registry.
 * @param chains - Map of chain name to Chain object.
 * @returns Hono app with GET / route for health checks.
 */
export function createHealthRoutes(
  registry: ProviderRegistry,
  chains: Map<string, Chain>,
) {
  const app = new Hono();

  app.get('/', (c) => {
    return c.json({
      status: 'ok',
      version: '0.1.0',
      uptime: process.uptime(),
      providers: registry.size,
      chains: chains.size,
    });
  });

  return app;
}
