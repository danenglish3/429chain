# Phase 2: SSE Streaming - Research

**Researched:** 2026-02-05
**Domain:** Server-Sent Events (SSE) streaming with Node.js/Hono
**Confidence:** HIGH

## Summary

Server-Sent Events (SSE) is the standard protocol for streaming OpenAI-compatible chat completions. The OpenAI API uses SSE with `Content-Type: text/event-stream` to deliver token-by-token responses as they're generated. Each chunk follows the SSE format with `data:` prefix and double-newline terminator, ending with `data: [DONE]` marker.

Hono provides mature SSE support through the `streamSSE()` helper, which automatically handles proper headers, event formatting, and cleanup. The key challenge is implementing pre-stream waterfall validation (exhausted provider detection before opening the stream), mid-stream error handling, and client disconnect cleanup via AbortController.

For Node.js streams, `stream.pipeline()` is the modern standard over `.pipe()` for automatic backpressure handling and comprehensive error cleanup. Memory leaks are a critical concern with SSE—manual event listener management and improper cleanup cause connection leaks. Hono's `onAbort()` callback provides the cleanup hook when clients disconnect.

**Primary recommendation:** Use Hono's `streamSSE()` helper with waterfall validation before stream initiation, implement AbortController wiring for upstream provider cleanup, and use `onAbort()` for connection cleanup.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Hono | 4.11.7 | HTTP framework | Built-in `streamSSE()` helper with proper SSE headers and abort handling |
| Node.js fetch | Native (Node ≥18) | HTTP client with streaming | Standard AbortSignal support for request cancellation |
| AbortController | Native | Cancellation signal | Web standard API for stream cleanup, supported across runtimes |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| stream.pipeline | Node.js native | Stream piping with auto-cleanup | If manually piping streams (prefer Hono helpers) |
| Pino | 10.3.0 | Logging | Already in project, use for stream lifecycle logging |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hono `streamSSE()` | Manual SSE formatting | Manual approach error-prone: must handle event format, headers, cleanup |
| Native AbortController | Third-party cancellation | AbortController is Web standard, no dependencies needed |
| `stream.pipeline()` | `.pipe()` | `.pipe()` lacks automatic error cleanup, use `pipeline()` |

**Installation:**
```bash
# No new dependencies needed - Hono 4.11.7 includes streamSSE()
# Node.js ≥18 includes fetch and AbortController natively
```

## Architecture Patterns

### Recommended Flow Structure
```
Request arrives
├── Parse and validate request body
├── Resolve chain
├── **PRE-STREAM WATERFALL** (validate available provider)
│   ├── Check each chain entry for isExhausted()
│   └── Return 503 if all exhausted (don't start stream)
├── Open SSE stream with streamSSE()
├── Fetch from provider with AbortSignal
├── Pipe chunks to client via writeSSE()
├── Handle mid-stream errors
│   ├── Write error event to stream
│   └── Close stream gracefully
└── Cleanup on disconnect via onAbort()
    └── Call upstream AbortController.abort()
```

### Pattern 1: Pre-Stream Waterfall Validation
**What:** Check for available providers BEFORE opening the SSE stream
**When to use:** Every streaming request (required by success criteria)
**Example:**
```typescript
// Source: Phase requirements - "Waterfall routing works before streaming begins"
// Check for exhausted providers BEFORE streamSSE()
const availableEntry = chain.entries.find(entry => {
  const key = `${entry.providerId}:${entry.model}`;
  return !tracker.isExhausted(key);
});

if (!availableEntry) {
  return c.json({ error: 'All providers exhausted' }, 503);
}

// NOW safe to open stream
return streamSSE(c, async (stream) => {
  // streaming logic
});
```

### Pattern 2: SSE Stream Bridging with Hono
**What:** Use Hono's `streamSSE()` helper to bridge upstream provider SSE to client
**When to use:** All streaming responses
**Example:**
```typescript
// Source: https://hono.dev/docs/helpers/streaming
import { streamSSE } from 'hono/streaming';

return streamSSE(c, async (stream) => {
  const abortController = new AbortController();

  // Cleanup on client disconnect
  stream.onAbort(() => {
    logger.debug('Client disconnected, aborting upstream request');
    abortController.abort();
  });

  try {
    const response = await fetch(providerUrl, {
      signal: abortController.signal,
      // ... other options
    });

    // Parse SSE chunks from upstream and forward
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      // Parse and forward SSE events
      await stream.writeSSE({ data: chunk });
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      logger.debug('Upstream request aborted (client disconnect)');
      return; // Clean exit
    }
    throw error;
  }
});
```

### Pattern 3: OpenAI SSE Format Parsing
**What:** Parse upstream SSE format and forward chunks
**When to use:** When proxying OpenAI-compatible streaming responses
**Example:**
```typescript
// Source: https://github.com/openai/openai-cookbook/blob/main/examples/How_to_stream_completions.ipynb
// OpenAI streams: "data: {json}\n\n" or "data: [DONE]\n\n"

function parseSSEChunk(text: string): string[] {
  return text
    .split('\n\n')
    .filter(line => line.startsWith('data: '))
    .map(line => line.slice(6)); // Remove "data: " prefix
}

// In stream handler:
const chunks = parseSSEChunk(chunk);
for (const data of chunks) {
  if (data === '[DONE]') {
    break; // Stream complete
  }
  const parsed = JSON.parse(data); // OpenAI chunk object
  await stream.writeSSE({ data: JSON.stringify(parsed) });
}
```

### Pattern 4: AbortController Cleanup Chain
**What:** Wire AbortController through adapter → fetch → cleanup
**When to use:** All streaming requests requiring upstream cancellation
**Example:**
```typescript
// Source: https://medium.com/@kaushalsinh73/node-js-abortcontroller-everywhere-cancellation-safe-fetch-streams-and-workers-993cf26bd5b4
// In BaseAdapter:
async chatCompletionStream(
  model: string,
  body: ChatCompletionRequest,
  signal?: AbortSignal
): Promise<Response> {
  const url = `${this.baseUrl}/chat/completions`;
  const requestBody = this.prepareRequestBody(model, body);

  const response = await fetch(url, {
    method: 'POST',
    headers: { /* ... */ },
    body: JSON.stringify(requestBody),
    signal, // Forward AbortSignal to fetch
  });

  return response; // Return raw Response with .body stream
}
```

### Pattern 5: Mid-Stream Error Recovery
**What:** Handle provider errors during streaming without crashing
**When to use:** Provider returns error mid-stream (e.g., content policy violation)
**Example:**
```typescript
// Source: https://www.speakeasy.com/openapi/content/server-sent-events
// In streamSSE callback:
try {
  // ... streaming logic
} catch (error) {
  if (error.name === 'AbortError') {
    return; // Clean disconnect, don't log as error
  }

  // Send error event to client
  await stream.writeSSE({
    event: 'error',
    data: JSON.stringify({ error: error.message })
  });

  logger.error({ error, provider: providerId }, 'Mid-stream error');
  // Stream will close after writeSSE completes
}
```

### Anti-Patterns to Avoid
- **Opening stream before waterfall validation:** Clients get empty stream if all providers exhausted—validate first
- **Using `.pipe()` for streams:** Lacks automatic error cleanup—use `stream.pipeline()` or Hono's helpers
- **Manual event listener cleanup:** Causes memory leaks—use `{ once: true }` option or `onAbort()`
- **Ignoring AbortError:** Logs false errors on disconnect—check `error.name === 'AbortError'`
- **Not forwarding AbortSignal:** Upstream requests leak when client disconnects—always pass signal to fetch
- **Buffering SSE chunks:** Defeats real-time streaming—write chunks immediately with `writeSSE()`

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSE event formatting | Custom `data: ${msg}\n\n` string builder | Hono's `streamSSE()` | Handles event/id/retry fields, proper escaping, double-newline terminators |
| Stream abort handling | Manual cleanup tracking | AbortController + `onAbort()` | Web standard API, automatic cleanup, prevents memory leaks |
| Stream backpressure | Manual `.write()` + `drain` events | `stream.pipeline()` or Hono helpers | Automatic backpressure, prevents memory exhaustion |
| Client disconnect detection | Manual `req.on('close')` | Hono's `stream.onAbort()` | Works across runtimes (Node, Bun, Workers), already integrated |
| SSE parsing | Regex or split-based parser | Simple `split('\n\n')` + prefix check | SSE format is simple, but handle edge cases (empty lines, [DONE] marker) |

**Key insight:** SSE seems simple (just `data: \n\n`) but has edge cases: event/id fields, line splitting in data content, proper connection cleanup, backpressure handling. Hono's `streamSSE()` handles all of this correctly.

## Common Pitfalls

### Pitfall 1: Memory Leaks from Unclosed Streams
**What goes wrong:** EventSource connections not cleaned up, RSS/heap memory grows unbounded
**Why it happens:** Forgetting to abort upstream requests on client disconnect, or not removing event listeners
**How to avoid:**
1. Always use `stream.onAbort()` to register cleanup
2. Pass AbortSignal to upstream fetch()
3. Call `abortController.abort()` in onAbort callback
**Warning signs:**
- Memory usage increases over time
- MaxListenersExceededWarning in logs
- Open connections remain after clients disconnect

### Pitfall 2: Starting Stream Before Waterfall Validation
**What goes wrong:** Client receives SSE headers but no data, gets `data: [DONE]` immediately or hangs
**Why it happens:** Opening `streamSSE()` before checking if any providers are available
**How to avoid:**
1. Check `tracker.isExhausted()` for all chain entries BEFORE `streamSSE()`
2. Return 503 JSON error if all exhausted
3. Only call `streamSSE()` after confirming available provider
**Warning signs:**
- Empty streams with immediate completion
- 503 errors arriving mid-stream (too late)
- Test "all providers exhausted" fails

### Pitfall 3: Buffering Defeats Real-Time Streaming
**What goes wrong:** Chunks arrive in bursts instead of real-time token-by-token
**Why it happens:** Proxy/reverse proxy buffering, or not calling `writeSSE()` immediately on chunk arrival
**How to avoid:**
1. Set `Cache-Control: no-cache` header (Hono's `streamSSE()` does this)
2. Write chunks immediately in read loop, don't batch
3. Avoid `await` between read and write (introduces delay)
4. If using nginx/reverse proxy, configure `proxy_buffering off`
**Warning signs:**
- Chunks arrive in large bursts
- Perceptible delay between token generation and client display
- Success criteria "no perceptible buffering delay" fails

### Pitfall 4: Not Handling AbortError Separately
**What goes wrong:** Logs flooded with error messages on normal client disconnects
**Why it happens:** Catching errors without checking `error.name === 'AbortError'`
**How to avoid:**
```typescript
} catch (error) {
  if (error.name === 'AbortError') {
    // This is normal - client disconnected
    logger.debug('Request aborted');
    return;
  }
  // Real error - log and handle
  logger.error({ error }, 'Stream error');
}
```
**Warning signs:**
- Error logs on every client disconnect
- AbortError stack traces in production logs

### Pitfall 5: Mid-Stream Provider Errors Crash Server
**What goes wrong:** Unhandled exception in `streamSSE()` callback kills the Hono instance
**Why it happens:** Not providing error handler to `streamSSE()`, or not try-catching stream logic
**How to avoid:**
1. Wrap stream logic in try-catch
2. Pass error handler as 3rd argument to `streamSSE()` (optional but recommended)
3. Send error event to client before closing stream
**Warning signs:**
- Server crashes on provider timeout mid-stream
- GitHub issue mentions: "Throwing unhandled exception in streamSSE brings down server"

### Pitfall 6: Race Condition in isExhausted Check
**What goes wrong:** Provider marked exhausted between waterfall check and fetch()
**Why it happens:** Time gap between `isExhausted()` check and actual fetch call
**How to avoid:** Already handled by [d006] decision - `isExhausted()` double-checks cooldown timestamp. Acceptable if fetch fails with 429 and returns error event.
**Warning signs:** 429 errors during streaming (rare but acceptable, client sees error event)

## Code Examples

Verified patterns from official sources:

### Complete Streaming Handler with Waterfall
```typescript
// Source: Synthesized from Hono docs + project patterns
import { streamSSE } from 'hono/streaming';

app.post('/chat/completions', async (c) => {
  const body = await c.req.json<ChatCompletionRequest>();
  const chain = resolveChain(body.model, chains, defaultChainName);

  // PRE-STREAM WATERFALL: Find available provider
  let selectedEntry = null;
  const attempts: string[] = [];

  for (const entry of chain.entries) {
    const key = `${entry.providerId}:${entry.model}`;
    if (tracker.isExhausted(key)) {
      attempts.push(`${key}:exhausted`);
      continue;
    }
    selectedEntry = entry;
    break;
  }

  if (!selectedEntry) {
    logger.warn({ chain: chain.name, attempts }, 'All providers exhausted');
    return c.json({ error: 'All providers in chain exhausted' }, 503);
  }

  // NOW safe to open stream
  return streamSSE(c, async (stream) => {
    const abortController = new AbortController();

    // Cleanup on client disconnect
    stream.onAbort(() => {
      logger.debug('Client disconnected, aborting upstream');
      abortController.abort();
    });

    try {
      const adapter = registry.get(selectedEntry.providerId);
      const response = await adapter.chatCompletionStream(
        selectedEntry.model,
        body,
        abortController.signal
      );

      // Pipe SSE chunks
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const events = parseSSEChunk(chunk);

        for (const data of events) {
          if (data === '[DONE]') break;
          await stream.writeSSE({ data });
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        return; // Clean disconnect
      }
      // Send error to client
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: error.message })
      });
    }
  });
});
```

### SSE Chunk Parser (OpenAI Format)
```typescript
// Source: OpenAI cookbook + SSE spec
function parseSSEChunk(text: string): string[] {
  // SSE format: "data: content\n\n"
  // Split on double newline, filter for data: prefix
  return text
    .split('\n\n')
    .filter(line => line.trim().startsWith('data: '))
    .map(line => line.replace(/^data: /, '').trim());
}
```

### BaseAdapter Streaming Method
```typescript
// Source: Existing base-adapter.ts pattern + AbortSignal
async chatCompletionStream(
  model: string,
  body: ChatCompletionRequest,
  signal?: AbortSignal,
): Promise<Response> {
  const url = `${this.baseUrl}/chat/completions`;
  const requestBody = this.prepareRequestBody(model, body);
  requestBody.stream = true; // Force streaming

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${this.apiKey}`,
    ...this.getExtraHeaders(),
  };

  logger.debug({ provider: this.id, model, url }, 'Starting stream');

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    signal, // Forward AbortSignal
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ provider: this.id, status: response.status }, 'Stream failed');
    throw new ProviderError(this.id, model, response.status, errorText);
  }

  return response; // Return Response with .body ReadableStream
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `.pipe()` for streams | `stream.pipeline()` | Node.js 10.x (2018) | Automatic error cleanup, better backpressure |
| Manual SSE formatting | Framework helpers (`streamSSE()`) | Hono 3+ | Handles edge cases, proper headers, cleanup |
| Custom AbortController polyfill | Native AbortController | Node.js 16.5.0 (2021) | No dependencies, Web standard API |
| Manual event listener cleanup | `{ once: true }` option | Web standard | Prevents memory leaks automatically |

**Deprecated/outdated:**
- **express-sse packages:** Abandoned, use framework-native streaming (Hono's `streamSSE()`)
- **better-sse package:** Useful for Express, but Hono has built-in support
- **Manual `res.write()` for SSE:** Error-prone, use `streamSSE()` helper

## Open Questions

Things that couldn't be fully resolved:

1. **OpenAI Rate Limit Headers During Streaming**
   - What we know: 429 errors before stream starts; mid-stream 429 unlikely but possible
   - What's unclear: Do providers send rate limit headers in streaming responses? If mid-stream 429 occurs, how is it formatted?
   - Recommendation: Implement error event handling; test with real providers to verify behavior. Assume 429s happen pre-stream (waterfall catches).

2. **Heartbeat/Keep-Alive Necessity**
   - What we know: Common pattern is `:keepalive\n\n` every 30-55 seconds for long connections
   - What's unclear: Does the proxy need heartbeats if provider already sends them? Do all providers send heartbeats?
   - Recommendation: Implement if testing shows client disconnects or proxy timeouts. Monitor for "idle connection" issues in production.

3. **Handling Partial SSE Chunks**
   - What we know: SSE events may span multiple TCP packets (partial reads)
   - What's unclear: Does Hono's `streamSSE()` handle partial events, or do we need to buffer?
   - Recommendation: Test with slow providers. If chunks arrive incomplete, implement buffering logic to accumulate until `\n\n` terminator.

## Sources

### Primary (HIGH confidence)
- [Hono Streaming Helper Documentation](https://hono.dev/docs/helpers/streaming) - streamSSE() API, onAbort() method
- [Hono SSE Implementation Source](https://github.com/honojs/hono/blob/main/src/helper/streaming/sse.ts) - Internal implementation details
- [Node.js Backpressuring Guide](https://nodejs.org/en/learn/modules/backpressuring-in-streams) - pipeline() vs pipe()
- [OpenAI Cookbook - How to Stream Completions](https://github.com/openai/openai-cookbook/blob/main/examples/How_to_stream_completions.ipynb) - SSE format with [DONE] marker
- [Better Stack - AbortController Guide](https://betterstack.com/community/guides/scaling-nodejs/understanding-abortcontroller/) - AbortController patterns
- [MDN - Using Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) - SSE protocol spec

### Secondary (MEDIUM confidence)
- [KrakenD - HTTP Streaming and SSE](https://www.krakend.io/docs/enterprise/endpoints/streaming/) - Proxy buffering issues
- [DEV Community - pipe() vs pipeline()](https://dev.to/sudiip__17/-pipe-vs-pipeline-why-modern-nodejs-developers-choose-pipeline-54ae) - Modern recommendations
- [Server-Sent Events Practical Guide](https://tigerabrodi.blog/server-sent-events-a-practical-guide-for-the-real-world) - Error handling patterns
- [GitHub Issue - Hono streamSSE Exception Handling](https://github.com/honojs/hono/issues/2164) - Known pitfall

### Tertiary (LOW confidence)
- Various Medium articles on SSE patterns - Community patterns, not verified with official docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Hono 4.11.7 includes `streamSSE()`, Node.js ≥18 has native fetch/AbortController
- Architecture: HIGH - Patterns verified with Hono official docs and Node.js guides
- Pitfalls: MEDIUM-HIGH - Sourced from GitHub issues and community reports, common failure modes

**Research date:** 2026-02-05
**Valid until:** 2026-03-05 (30 days - stable APIs)
