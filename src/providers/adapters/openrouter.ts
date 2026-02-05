/**
 * OpenRouter adapter.
 * Handles OpenRouter-specific extra headers (HTTP-Referer, X-Title)
 * and rate limit header parsing (X-RateLimit-* format).
 */

import { BaseAdapter } from '../base-adapter.js';
import type { RateLimitInfo } from '../types.js';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

export class OpenRouterAdapter extends BaseAdapter {
  constructor(id: string, name: string, apiKey: string, baseUrl?: string) {
    super(id, 'openrouter', name, apiKey, baseUrl ?? DEFAULT_BASE_URL);
  }

  /**
   * OpenRouter requires HTTP-Referer and X-Title headers
   * to identify the application for analytics.
   */
  override getExtraHeaders(): Record<string, string> {
    return {
      'HTTP-Referer': '429chain',
      'X-Title': '429chain',
    };
  }

  /**
   * Parse OpenRouter rate limit headers.
   *
   * Format:
   *   X-RateLimit-Limit      -> max requests in window
   *   X-RateLimit-Remaining  -> requests remaining
   *   X-RateLimit-Reset      -> Unix timestamp in MILLISECONDS
   */
  override parseRateLimitHeaders(headers: Headers): RateLimitInfo | null {
    const limit = headers.get('x-ratelimit-limit');
    const remaining = headers.get('x-ratelimit-remaining');
    const reset = headers.get('x-ratelimit-reset');

    if (limit === null && remaining === null && reset === null) {
      return null;
    }

    const info: RateLimitInfo = {};

    if (limit !== null) {
      const parsed = parseInt(limit, 10);
      if (!isNaN(parsed)) info.limitRequests = parsed;
    }

    if (remaining !== null) {
      const parsed = parseInt(remaining, 10);
      if (!isNaN(parsed)) info.remainingRequests = parsed;
    }

    if (reset !== null) {
      const resetMs = parseInt(reset, 10);
      if (!isNaN(resetMs)) {
        // OpenRouter reset is a Unix timestamp in milliseconds.
        // Convert to ms-from-now.
        const now = Date.now();
        const msFromNow = resetMs - now;
        info.resetRequestsMs = Math.max(0, msFromNow);
      }
    }

    return info;
  }
}
