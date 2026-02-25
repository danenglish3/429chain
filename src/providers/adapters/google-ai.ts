/**
 * Google AI Studio adapter.
 * Uses Google's OpenAI-compatible endpoint for Gemini models.
 *
 * Rate limit headers are only available in 429 error responses,
 * not in successful responses. Uses standard Retry-After header.
 *
 * Non-Gemini models (e.g. Gemma) do not support system/developer
 * instructions. For these models, system messages are merged into
 * the first user message automatically.
 */

import { logger } from '../../shared/logger.js';
import { BaseAdapter } from '../base-adapter.js';
import type { ChatCompletionRequest, ChatMessage } from '../../shared/types.js';
import type { RateLimitInfo } from '../types.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';

/** Whether the model supports advanced features (system instructions, JSON mode, tools). */
function isFullFeaturedModel(model: string): boolean {
  return model.startsWith('gemini-');
}

/** Parameters unsupported by limited models (e.g. Gemma). */
const LIMITED_MODEL_UNSUPPORTED_PARAMS: readonly (keyof ChatCompletionRequest)[] = [
  'response_format',
  'tools',
  'tool_choice',
];

export class GoogleAIAdapter extends BaseAdapter {
  constructor(id: string, name: string, apiKey: string, baseUrl?: string, timeout?: number) {
    super(id, 'google-ai', name, apiKey, baseUrl ?? DEFAULT_BASE_URL, timeout);
  }

  /**
   * For models that don't support advanced features (e.g. Gemma),
   * merge system messages into the first user message and strip
   * unsupported parameters (response_format, tools, tool_choice).
   */
  protected override prepareRequestBody(
    model: string,
    body: ChatCompletionRequest,
  ): Record<string, unknown> {
    const { model: _originalModel, ...rest } = body;
    const prepared: Record<string, unknown> = { ...rest, model, stream: false };

    if (!isFullFeaturedModel(model)) {
      for (const param of LIMITED_MODEL_UNSUPPORTED_PARAMS) {
        if (param in prepared) {
          logger.debug(
            { provider: this.id, model, param },
            'Stripping unsupported parameter for limited Google AI model',
          );
          delete prepared[param];
        }
      }
    }

    if (!isFullFeaturedModel(model) && body.messages.some((m) => m.role === 'system')) {
      const systemParts: string[] = [];
      const filtered: ChatMessage[] = [];

      for (const msg of body.messages) {
        if (msg.role === 'system') {
          if (msg.content) systemParts.push(msg.content);
        } else {
          filtered.push(msg);
        }
      }

      // Prepend system content to the first user message
      if (systemParts.length > 0 && filtered.length > 0) {
        const firstUserIdx = filtered.findIndex((m) => m.role === 'user');
        if (firstUserIdx !== -1) {
          const userMsg = filtered[firstUserIdx];
          filtered[firstUserIdx] = {
            ...userMsg,
            content: systemParts.join('\n') + '\n\n' + (userMsg.content ?? ''),
          };
        } else {
          // No user message — insert a synthetic one at the start
          filtered.unshift({ role: 'user', content: systemParts.join('\n') });
        }
      }

      prepared.messages = filtered;

      logger.debug(
        { provider: this.id, model, systemMessages: systemParts.length },
        'Merged system messages into user message for model without system instruction support',
      );
    }

    return prepared;
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
