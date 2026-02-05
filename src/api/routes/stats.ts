/**
 * Stats routes for querying usage aggregations.
 * Provides access to per-provider, per-chain usage stats and recent request logs.
 */

import { Hono } from 'hono';
import type { UsageAggregator } from '../../persistence/aggregator.js';

/**
 * Create stats routes with injected aggregator dependency.
 * @param aggregator - UsageAggregator instance for reading materialized stats.
 * @returns Hono sub-app with stats endpoints.
 */
export function createStatsRoutes(aggregator: UsageAggregator) {
  const app = new Hono();

  // GET /providers - All provider usage statistics
  app.get('/providers', (c) => {
    return c.json({
      providers: aggregator.getAllProviderUsage(),
    });
  });

  // GET /providers/:providerId - Single provider usage statistics
  app.get('/providers/:providerId', (c) => {
    const providerId = c.req.param('providerId');
    const usage = aggregator.getProviderUsage(providerId);

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
      chains: aggregator.getAllChainUsage(),
    });
  });

  // GET /chains/:chainName - Single chain usage statistics
  app.get('/chains/:chainName', (c) => {
    const chainName = c.req.param('chainName');
    const usage = aggregator.getChainUsage(chainName);

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
      requests: aggregator.getRecentRequests(cappedLimit),
    });
  });

  return app;
}
