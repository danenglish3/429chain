/**
 * Rate limit status routes.
 * Provides live rate limit status for all tracked provider+model pairs.
 */

import { Hono } from 'hono';
import type { RateLimitTracker } from '../../ratelimit/tracker.js';
import type { Chain } from '../../chain/types.js';

/**
 * Create rate limit routes with injected tracker dependency.
 * @param tracker - RateLimitTracker instance for reading live rate limit state.
 * @param chains - Map of chain name to Chain object for computing active entries.
 * @returns Hono sub-app with rate limit endpoints.
 */
export function createRateLimitRoutes(tracker: RateLimitTracker, chains: Map<string, Chain>) {
  const app = new Hono();

  // GET / - All rate limit statuses
  app.get('/', (c) => {
    const statuses = tracker.getAllStatuses();

    // Compute active entry per chain (first non-exhausted entry)
    const activeEntries: Array<{ chain: string; provider: string; model: string }> = [];
    for (const [name, chain] of chains) {
      for (const entry of chain.entries) {
        if (!tracker.isExhausted(entry.providerId, entry.model)) {
          activeEntries.push({ chain: name, provider: entry.providerId, model: entry.model });
          break;
        }
      }
    }

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
      activeEntries,
    });
  });

  return app;
}
