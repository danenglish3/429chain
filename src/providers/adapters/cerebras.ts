/**
 * Cerebras adapter.
 * Handles Cerebras-specific parameter stripping (presence_penalty, frequency_penalty)
 * and rate limit header parsing with day/minute granularity.
 */

import { logger } from '../../shared/logger.js';
import { BaseAdapter } from '../base-adapter.js';
import type { RateLimitInfo } from '../types.js';
import type { ChatCompletionRequest } from '../../shared/types.js';

const DEFAULT_BASE_URL = 'https://api.cerebras.ai/v1';

/** Parameters that Cerebras does not support. */
const UNSUPPORTED_PARAMS: readonly (keyof ChatCompletionRequest)[] = [
  'presence_penalty',
  'frequency_penalty',
];

export class CerebrasAdapter extends BaseAdapter {
  constructor(id: string, name: string, apiKey: string, baseUrl?: string, timeout?: number) {
    super(id, 'cerebras', name, apiKey, baseUrl ?? DEFAULT_BASE_URL, timeout);
  }

  /**
   * Cerebras does not support presence_penalty and frequency_penalty.
   * Strip them from the request body before sending.
   */
  protected override prepareRequestBody(
    model: string,
    body: ChatCompletionRequest,
  ): Record<string, unknown> {
    const { model: _originalModel, ...rest } = body;
    const prepared: Record<string, unknown> = { ...rest, model, stream: false };

    for (const param of UNSUPPORTED_PARAMS) {
      if (param in prepared) {
        logger.debug(
          { provider: this.id, model, param },
          'Stripping unsupported parameter for Cerebras',
        );
        delete prepared[param];
      }
    }

    return prepared;
  }

  /**
   * Parse Cerebras rate limit headers.
   *
   * Format:
   *   x-ratelimit-limit-requests-day       -> daily request limit
   *   x-ratelimit-remaining-requests-day   -> remaining daily requests
   *   x-ratelimit-reset-requests-day       -> seconds until daily reset
   *   x-ratelimit-limit-tokens-minute      -> per-minute token limit
   *   x-ratelimit-remaining-tokens-minute  -> remaining per-minute tokens
   *   x-ratelimit-reset-tokens-minute      -> seconds until per-minute reset
   */
  override parseRateLimitHeaders(headers: Headers): RateLimitInfo | null {
    const limitReqDay = headers.get('x-ratelimit-limit-requests-day');
    const remainingReqDay = headers.get('x-ratelimit-remaining-requests-day');
    const resetReqDay = headers.get('x-ratelimit-reset-requests-day');
    const limitTokMin = headers.get('x-ratelimit-limit-tokens-minute');
    const remainingTokMin = headers.get('x-ratelimit-remaining-tokens-minute');
    const resetTokMin = headers.get('x-ratelimit-reset-tokens-minute');

    if (
      limitReqDay === null &&
      remainingReqDay === null &&
      resetReqDay === null &&
      limitTokMin === null &&
      remainingTokMin === null &&
      resetTokMin === null
    ) {
      return null;
    }

    const info: RateLimitInfo = {};

    if (limitReqDay !== null) {
      const parsed = parseInt(limitReqDay, 10);
      if (!isNaN(parsed)) info.limitRequests = parsed;
    }

    if (remainingReqDay !== null) {
      const parsed = parseInt(remainingReqDay, 10);
      if (!isNaN(parsed)) info.remainingRequests = parsed;
    }

    if (resetReqDay !== null) {
      const seconds = parseFloat(resetReqDay);
      if (!isNaN(seconds)) {
        info.resetRequestsMs = Math.round(seconds * 1000);
      }
    }

    if (limitTokMin !== null) {
      const parsed = parseInt(limitTokMin, 10);
      if (!isNaN(parsed)) info.limitTokens = parsed;
    }

    if (remainingTokMin !== null) {
      const parsed = parseInt(remainingTokMin, 10);
      if (!isNaN(parsed)) info.remainingTokens = parsed;
    }

    if (resetTokMin !== null) {
      const seconds = parseFloat(resetTokMin);
      if (!isNaN(seconds)) {
        info.resetTokensMs = Math.round(seconds * 1000);
      }
    }

    return info;
  }
}
