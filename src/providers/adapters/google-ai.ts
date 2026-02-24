/**
 * Google AI Studio adapter.
 * Uses Google's OpenAI-compatible endpoint for Gemini models.
 *
 * Rate limit headers are only available in 429 error responses,
 * not in successful responses. Uses standard Retry-After header.
 */

import { BaseAdapter } from '../base-adapter.js';
import type { RateLimitInfo } from '../types.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

export class GoogleAIAdapter extends BaseAdapter {
  constructor(id: string, name: string, apiKey: string, baseUrl?: string, timeout?: number) {
    super(id, 'google-ai', name, apiKey, baseUrl ?? DEFAULT_BASE_URL, timeout);
  }

  /**
   * Parse Google AI rate limit headers.
   *
   * Google's Gemini API only provides rate limit info in 429 responses,
   * not in successful responses. When available, uses the standard
   * Retry-After header with seconds to wait.
   *
   * Format:
   *   Retry-After -> seconds to wait before retrying
   */
  override parseRateLimitHeaders(headers: Headers): RateLimitInfo | null {
    const retryAfter = headers.get('retry-after');

    if (retryAfter === null) {
      return null;
    }

    const info: RateLimitInfo = {};

    // Retry-After can be seconds (number) or HTTP-date
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      info.resetRequestsMs = seconds * 1000;
    } else {
      // Try parsing as HTTP-date
      const date = Date.parse(retryAfter);
      if (!isNaN(date)) {
        const msFromNow = date - Date.now();
        info.resetRequestsMs = Math.max(0, msFromNow);
      }
    }

    return Object.keys(info).length > 0 ? info : null;
  }
}
