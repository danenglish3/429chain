/**
 * Stats routes for querying usage aggregations.
 * Provides access to per-provider, per-chain usage stats and recent request logs.
 */

import { Hono } from 'hono';
import type { IStatsRepository } from '../../persistence/repositories/interfaces.js';

/**
 * Create stats routes with injected stats repository dependency.
 * @param stats - IStatsRepository instance for reading materialized stats.
 * @returns Hono sub-app with stats endpoints.
 */
export function createStatsRoutes(stats: IStatsRepository) {
  const app = new Hono();

  // GET /summary - Summary statistics across all requests
  app.get('/summary', (c) => {
    return c.json({
      summary: stats.getSummaryStats(),
    });
  });

  // GET /providers - All provider usage statistics
  app.get('/providers', (c) => {
    return c.json({
      providers: stats.getAllProviderUsage(),
    });
  });

  // GET /providers/:providerId - Single provider usage statistics
  app.get('/providers/:providerId', (c) => {
    const providerId = c.req.param('providerId');
    const usage = stats.getProviderUsage(providerId);

    if (usage === null) {
      return c.json(
        { error: 'No usage data for provider' },
        404,
      );
    }

    return c.json(usage);
  });

  // GET /chains - All chain usage statistics
  app.get('/chains', (c) => {
    return c.json({
      chains: stats.getAllChainUsage(),
    });
  });

  // GET /chains/:chainName - Single chain usage statistics
  app.get('/chains/:chainName', (c) => {
    const chainName = c.req.param('chainName');
    const usage = stats.getChainUsage(chainName);

    if (usage === null) {
      return c.json(
        { error: 'No usage data for chain' },
        404,
      );
    }

    return c.json(usage);
  });

  // GET /requests - Recent request logs
  app.get('/requests', (c) => {
    const limitParam = c.req.query('limit');
    const limit = limitParam ? Number(limitParam) : 50;
    const cappedLimit = Math.min(limit, 500);

    return c.json({
      requests: stats.getRecentRequests(cappedLimit),
    });
  });

  return app;
}
