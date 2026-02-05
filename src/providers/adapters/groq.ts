/**
 * Groq adapter.
 * Handles Groq-specific rate limit header parsing with dual request/token
 * tracking and duration string parsing for reset times.
 */

import { BaseAdapter } from '../base-adapter.js';
import type { RateLimitInfo } from '../types.js';

const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';

/**
 * Parse a Groq duration string (e.g., "6m23.456s", "1.5s", "2m0s") into milliseconds.
 * Groq uses this format for x-ratelimit-reset-requests and x-ratelimit-reset-tokens.
 *
 * Supported formats:
 *   "6m23.456s"  -> 383456 ms
 *   "1.5s"       -> 1500 ms
 *   "2m0s"       -> 120000 ms
 *   "0s"         -> 0 ms
 *   "500ms"      -> 500 ms
 *   "2h30m0s"    -> 9000000 ms
 */
export function parseDurationToMs(str: string): number {
  let totalMs = 0;

  // Match hours
  const hoursMatch = str.match(/(\d+(?:\.\d+)?)h/);
  if (hoursMatch) {
    totalMs += parseFloat(hoursMatch[1]) * 3600000;
  }

  // Match minutes
  const minutesMatch = str.match(/(\d+(?:\.\d+)?)m(?!s)/);
  if (minutesMatch) {
    totalMs += parseFloat(minutesMatch[1]) * 60000;
  }

  // Match seconds
  const secondsMatch = str.match(/(\d+(?:\.\d+)?)s/);
  if (secondsMatch) {
    totalMs += parseFloat(secondsMatch[1]) * 1000;
  }

  // Match milliseconds
  const msMatch = str.match(/(\d+(?:\.\d+)?)ms/);
  if (msMatch) {
    totalMs += parseFloat(msMatch[1]);
  }

  return Math.round(totalMs);
}

export class GroqAdapter extends BaseAdapter {
  constructor(id: string, name: string, apiKey: string, baseUrl?: string) {
    super(id, 'groq', name, apiKey, baseUrl ?? DEFAULT_BASE_URL);
  }

  /**
   * Parse Groq rate limit headers.
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
