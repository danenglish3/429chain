/**
 * Pure functions for normalizing reasoning_content into content.
 * Used when config.settings.normalizeResponses is true to ensure
 * reasoning models (e.g. DeepSeek R1) output appears in the standard content field.
 */

import type { ChatCompletionResponse, ChatCompletionChunk } from './types.js';

/**
 * Normalize non-streaming response by moving reasoning_content to content when content is empty.
 * Mutates the response object in place for efficiency.
 *
 * @param response - The chat completion response to normalize
 * @returns The same response object (mutated)
 */
export function normalizeResponse(response: ChatCompletionResponse): ChatCompletionResponse {
  for (const choice of response.choices) {
    const msg = choice.message;

    // Only move reasoning_content if:
    // 1. reasoning_content exists and is truthy
    // 2. content is null, undefined, or empty string
    if (msg.reasoning_content && (!msg.content || msg.content === '')) {
      msg.content = msg.reasoning_content;
      delete msg.reasoning_content;
    }
  }

  return response;
}

/**
 * Normalize streaming chunk by moving delta.reasoning_content to delta.content when content is absent.
 * Returns JSON string (possibly modified).
 *
 * @param data - SSE data line (either JSON chunk or "[DONE]")
 * @returns Normalized data string
 */
export function normalizeChunk(data: string): string {
  // Pass through [DONE] marker unchanged
  if (data === '[DONE]') {
    return data;
  }

  try {
    const parsed = JSON.parse(data) as ChatCompletionChunk;

    for (const choice of parsed.choices) {
      const delta = choice.delta;

      // Only move reasoning_content if:
      // 1. reasoning_content exists and is truthy
      // 2. content is null or undefined (note: not checking for empty string in streaming)
      if (delta.reasoning_content && (delta.content === null || delta.content === undefined)) {
        delta.content = delta.reasoning_content;
        delete delta.reasoning_content;
      }
    }

    return JSON.stringify(parsed);
  } catch {
    // Defensive: if parsing fails, return original data unchanged
    // Never break streaming due to unexpected format
    return data;
  }
}
