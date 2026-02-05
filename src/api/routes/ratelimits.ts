/**
 * Rate limit status routes.
 * Provides live rate limit status for all tracked provider+model pairs.
 */

import { Hono } from 'hono';
import type { RateLimitTracker } from '../../ratelimit/tracker.js';

/**
 * Create rate limit routes with injected tracker dependency.
 * @param tracker - RateLimitTracker instance for reading live rate limit state.
 * @returns Hono sub-app with rate limit endpoints.
 */
export function createRateLimitRoutes(tracker: RateLimitTracker) {
  const app = new Hono();

  // GET / - All rate limit statuses
  app.get('/', (c) => {
    const statuses = tracker.getAllStatuses();

    return c.json({
      ratelimits: statuses.map((entry) => ({
        provider: entry.providerId,
        model: entry.model,
        status: entry.status,
        cooldownUntil: entry.cooldownUntil,
        reason: entry.reason,
        quota: entry.quota
          ? {
              remainingRequests: entry.quota.remainingRequests,
              remainingTokens: entry.quota.remainingTokens,
              resetRequestsMs: entry.quota.resetRequestsMs,
              resetTokensMs: entry.quota.resetTokensMs,
              lastUpdated: entry.quota.lastUpdated,
            }
          : null,
      })),
    });
  });

  return app;
}
