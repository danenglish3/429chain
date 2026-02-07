/**
 * OpenAI adapter.
 * Handles OpenAI-specific rate limit header parsing with dual request/token
 * tracking and duration string parsing for reset times.
 */

import { BaseAdapter } from '../base-adapter.js';
import type { RateLimitInfo } from '../types.js';
import { parseDurationToMs } from '../utils.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export class OpenAIAdapter extends BaseAdapter {
  constructor(id: string, name: string, apiKey: string, baseUrl?: string, timeout?: number) {
    super(id, 'openai', name, apiKey, baseUrl ?? DEFAULT_BASE_URL, timeout);
  }

  /**
   * Parse OpenAI rate limit headers.
   *
   * Format:
   *   x-ratelimit-limit-requests       -> max requests (RPD)
   *   x-ratelimit-remaining-requests   -> remaining requests
   *   x-ratelimit-reset-requests       -> duration string until request reset
   *   x-ratelimit-limit-tokens         -> max tokens (TPM)
   *   x-ratelimit-remaining-tokens     -> remaining tokens
   *   x-ratelimit-reset-tokens         -> duration string until token reset
   *   retry-after                      -> seconds (only on 429)
   */
  override parseRateLimitHeaders(headers: Headers): RateLimitInfo | null {
    const limitReq = headers.get('x-ratelimit-limit-requests');
    const remainingReq = headers.get('x-ratelimit-remaining-requests');
    const resetReq = headers.get('x-ratelimit-reset-requests');
    const limitTok = headers.get('x-ratelimit-limit-tokens');
    const remainingTok = headers.get('x-ratelimit-remaining-tokens');
    const resetTok = headers.get('x-ratelimit-reset-tokens');
    const retryAfter = headers.get('retry-after');

    if (
      limitReq === null &&
      remainingReq === null &&
      resetReq === null &&
      limitTok === null &&
      remainingTok === null &&
      resetTok === null &&
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

    if (resetReq !== null) {
      info.resetRequestsMs = parseDurationToMs(resetReq);
    }

    if (limitTok !== null) {
      const parsed = parseInt(limitTok, 10);
      if (!isNaN(parsed)) info.limitTokens = parsed;
    }

    if (remainingTok !== null) {
      const parsed = parseInt(remainingTok, 10);
      if (!isNaN(parsed)) info.remainingTokens = parsed;
    }

    if (resetTok !== null) {
      info.resetTokensMs = parseDurationToMs(resetTok);
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
