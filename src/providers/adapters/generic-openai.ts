/**
 * Generic OpenAI-compatible adapter.
 * For providers that follow the OpenAI API spec without any special
 * header formats or parameter quirks. Requires an explicit baseUrl.
 */

import { BaseAdapter } from '../base-adapter.js';
import type { RateLimitInfo } from '../types.js';

export class GenericOpenAIAdapter extends BaseAdapter {
  constructor(id: string, name: string, apiKey: string, baseUrl: string) {
    super(id, 'generic-openai', name, apiKey, baseUrl);
  }

  /**
   * Generic adapter: attempt to parse standard OpenAI-style rate limit headers.
   * Falls back to null if no recognized headers are present.
   *
   * Checks for common header patterns:
   *   x-ratelimit-limit-requests / x-ratelimit-remaining-requests
   *   x-ratelimit-limit-tokens / x-ratelimit-remaining-tokens
   *   retry-after (seconds)
   */
  override parseRateLimitHeaders(headers: Headers): RateLimitInfo | null {
    const limitReq = headers.get('x-ratelimit-limit-requests');
    const remainingReq = headers.get('x-ratelimit-remaining-requests');
    const limitTok = headers.get('x-ratelimit-limit-tokens');
    const remainingTok = headers.get('x-ratelimit-remaining-tokens');
    const retryAfter = headers.get('retry-after');

    if (
      limitReq === null &&
      remainingReq === null &&
      limitTok === null &&
      remainingTok === null &&
      retryAfter === null
    ) {
      return null;
    }

    const info: RateLimitInfo = {};

    if (limitReq !== null) {
      const parsed = parseInt(limitReq, 10);
      if (!isNaN(parsed)) info.limitRequests = parsed;
    }

    if (remainingReq !== null) {
      const parsed = parseInt(remainingReq, 10);
      if (!isNaN(parsed)) info.remainingRequests = parsed;
    }

    if (limitTok !== null) {
      const parsed = parseInt(limitTok, 10);
      if (!isNaN(parsed)) info.limitTokens = parsed;
    }

    if (remainingTok !== null) {
      const parsed = parseInt(remainingTok, 10);
      if (!isNaN(parsed)) info.remainingTokens = parsed;
    }

    if (retryAfter !== null) {
      const seconds = parseFloat(retryAfter);
      if (!isNaN(seconds)) {
        info.retryAfterMs = Math.round(seconds * 1000);
      }
    }

    return info;
  }
}
