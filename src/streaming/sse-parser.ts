/**
 * SSE stream parser for OpenAI-compatible streaming responses.
 * Handles buffering of partial chunks across TCP reads.
 */

/** Result of parsing an SSE chunk. */
export interface SSEParseResult {
  /** Complete SSE data payloads (JSON strings, NOT including [DONE]). */
  events: string[];
  /** True if [DONE] marker was encountered. */
  done: boolean;
}

/**
 * Create a stateful SSE parser that handles partial chunks.
 * Call parse() for each chunk received from the ReadableStream.
 * The parser buffers incomplete events across calls.
 *
 * @returns Object with parse() method.
 */
export function createSSEParser(): { parse(chunk: string): SSEParseResult } {
  let buffer = '';

  return {
    parse(chunk: string): SSEParseResult {
      buffer += chunk;
      const events: string[] = [];
      let done = false;

      // Split on double newline (SSE event boundary)
      const parts = buffer.split('\n\n');

      // Last part may be incomplete -- keep it in buffer
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue; // Empty segment
        if (trimmed.startsWith(':')) continue; // SSE comment / keepalive

        // Extract data from "data: ..." lines
        // An SSE event can have multiple lines; we care about data: lines
        const lines = trimmed.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6); // Remove "data: " prefix
            if (data === '[DONE]') {
              done = true;
            } else {
              events.push(data);
            }
          }
          // Ignore event:, id:, retry: fields (not used by OpenAI format)
        }
      }

      return { events, done };
    },
  };
}
