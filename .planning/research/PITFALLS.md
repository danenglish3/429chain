# Pitfalls Research

**Domain:** AI inference proxy/aggregator (OpenAI-compatible, free-tier waterfall)
**Researched:** 2026-02-05
**Confidence:** MEDIUM (based on training data knowledge of LiteLLM, Portkey, OneAPI, and direct experience with provider APIs; web verification was unavailable so specific version claims should be validated)

---

## Critical Pitfalls

These mistakes cause rewrites, data loss, or fundamental breakage that users will hit immediately.

---

### Pitfall 1: SSE Streaming Buffering Destroys User Experience

**What goes wrong:** The proxy buffers SSE chunks before forwarding them to the client, resulting in "bursty" output where the user sees nothing for seconds and then a wall of text appears at once. This happens because Node.js HTTP libraries, reverse proxies (nginx), and even `res.write()` itself can buffer output. The proxy technically "works" but the streaming UX is broken.

**Why it happens:**
- Node.js `http.ServerResponse` does not flush on every `write()` by default in all configurations
- If using Express with compression middleware, gzip buffers chunks waiting for enough data
- If behind nginx, `proxy_buffering on` (the default) accumulates the entire response
- `Transfer-Encoding: chunked` is not the same as SSE flushing -- chunked encoding can still buffer
- Many developers test with `curl` which shows raw output but miss that browser EventSource or SDK streaming clients experience buffering differently

**How to avoid:**
- Explicitly set `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive` and `X-Accel-Buffering: no` (for nginx) on every streaming response
- Call `res.flushHeaders()` before the first chunk
- If using compression middleware, exclude SSE routes from it entirely
- Test with the actual OpenAI Node SDK and Python SDK streaming iterators, not just curl
- Do NOT use `res.json()` or any body-parsing middleware on streaming routes
- Consider using raw `http.createServer` or Fastify (with reply.raw) instead of Express for the SSE path to avoid middleware interference

**Warning signs:**
- Streaming "works" in curl but SDK clients report delays
- First token latency (TTFT) is much higher through the proxy than direct to provider
- Users report "chunks arriving in bursts"
- Works fine locally but breaks behind a reverse proxy

**Phase to address:** Phase 1 (core proxy). This must be correct from day one -- retrofitting SSE handling is painful because it affects every route.

---

### Pitfall 2: Waterfall During Active Streaming Is Architecturally Hard

**What goes wrong:** The proxy starts streaming from Provider A, sends partial SSE chunks to the client, then Provider A fails mid-stream (connection drop, 500 error, timeout). The proxy wants to waterfall to Provider B, but the client has already received partial content. You cannot "restart" an SSE stream. The user sees truncated output or garbled responses.

**Why it happens:**
- SSE is a one-way, append-only protocol. Once bytes are sent to the client, they cannot be unsent.
- Unlike non-streaming requests where you can transparently retry with a different provider, streaming creates an irrecoverable commitment after the first chunk is sent.
- This is the fundamental tension in streaming proxies: low-latency first token vs. reliable completion.

**How to avoid:**
- Accept this as a design constraint: waterfall can only happen BEFORE streaming begins, not during it
- For pre-stream failures (connection refused, immediate 4xx/5xx): waterfall works perfectly, do it here
- For mid-stream failures: send an SSE error event (`data: [ERROR]`) and let the client decide. Do NOT silently switch providers mid-stream.
- Consider a "preflight" strategy: make a tiny non-streaming test request to validate the provider is alive before committing to a streaming response (adds latency, but prevents mid-stream failures)
- Document clearly that mid-stream failover is not supported and explain why
- Track provider health scores: if a provider has been dropping streams, deprioritize it in the waterfall

**Warning signs:**
- Users report "half responses" or responses that stop abruptly
- Error handling code has complex "resume from where we left off" logic (this approach does not work)
- Test suite only tests non-streaming waterfall

**Phase to address:** Phase 1 (core proxy). The waterfall design must account for this from the start. Trying to add mid-stream failover later leads to fragile, untestable code.

---

### Pitfall 3: Provider API "Compatibility" Is a Lie -- Death by a Thousand Paper Cuts

**What goes wrong:** Providers claim "OpenAI-compatible" but differ in dozens of subtle ways. The proxy works with Provider A but breaks with Provider B on edge cases. Each new provider integration becomes a whack-a-mole of fixes.

**Why it happens:** Every provider has quirks:
- **Response format differences:** Some providers return `choices[0].delta.content` as `null` vs `""` vs omitting the field entirely on the final chunk. Some include `usage` in the final streaming chunk, some don't. Some send `[DONE]` as the final SSE event, some send `data: [DONE]`, some just close the connection.
- **Error response shapes:** OpenAI returns `{ error: { message, type, code } }`. Some providers return `{ error: "string" }`. Some return HTML error pages on 500s. Some return 200 with an error in the body.
- **Header inconsistencies:** `x-ratelimit-remaining` vs `x-ratelimit-remaining-requests` vs `ratelimit-remaining` vs no headers at all. Reset times as Unix timestamps vs ISO 8601 vs seconds-from-now vs not present.
- **Model name mapping:** `gpt-4` vs `gpt-4-turbo` vs `openai/gpt-4` vs provider-specific model IDs. The same model can have different names across providers.
- **Token counting:** Some providers count tokens differently. Prompt token counts may not match between providers for the same input.
- **Streaming chunk boundaries:** Some providers send one token per SSE event. Some batch multiple tokens. Some send empty keep-alive events. Some send metadata events mixed with content events.
- **Request validation:** Some providers reject fields like `stream_options`, `tool_choice`, `response_format` that others accept. Sending unsupported fields may cause 400 errors or be silently ignored.

**How to avoid:**
- Build a provider adapter layer from day one. Each provider gets its own adapter that normalizes requests AND responses to a canonical internal format.
- The adapter handles: request transformation (outgoing), response transformation (incoming), error normalization, header parsing, SSE chunk normalization.
- Write integration tests against each real provider (not mocks) with a small test prompt. Run these in CI periodically.
- Maintain a provider compatibility matrix documenting known quirks.
- Parse SSE events defensively: handle missing fields, unexpected formats, and malformed JSON gracefully.
- For rate limit headers: build a parser per provider that knows which headers to look for and how to interpret them.

**Warning signs:**
- Adding a new provider requires changes in more than 2-3 files
- Bug reports are provider-specific ("works with OpenRouter but not Groq")
- Error handling code has many `if (provider === 'x')` branches outside the adapter layer
- Tests use a single mock provider shape

**Phase to address:** Phase 1 (provider adapters) and ongoing. The adapter architecture must exist from the start, but expect to iterate on individual adapters as new edge cases surface.

---

### Pitfall 4: Rate Limit State Is Harder Than It Looks

**What goes wrong:** The proxy tracks rate limits but the tracking is inaccurate, leading to either: (a) sending requests to exhausted providers (wasting time on 429s), or (b) skipping available providers (wasting free capacity). The state management becomes a subtle, hard-to-debug mess.

**Why it happens:**
- **Multiple limit dimensions:** A single provider can have RPM (requests per minute), RPD (requests per day), TPM (tokens per minute), TPD (tokens per day), and concurrent request limits -- all independently tracked and any one can trigger a 429.
- **Rolling vs fixed windows:** Some limits reset at fixed times (midnight UTC for daily), some are rolling windows (last 60 seconds). Treating a rolling window as fixed causes incorrect reset predictions.
- **Race conditions:** Multiple concurrent requests read "3 requests remaining", all proceed, but only 1 succeeds. In-memory counters need atomic operations or request queuing.
- **Unknown limits on free tiers:** Many free tiers don't document exact limits. You only discover them by hitting 429s. Some providers change limits without notice.
- **Header absence:** Not all providers send rate limit headers. Some only send them when you're close to the limit. Some send them on 429 responses but not on 200 responses.
- **Token estimation vs reality:** You don't know how many tokens a request will consume until the response is complete. Pre-flight estimation is imprecise, especially for streaming responses where output length is unknown.

**How to avoid:**
- Track rate limits as a layered system: (1) headers from responses (most accurate), (2) reactive 429 tracking (fallback), (3) manual config overrides (last resort)
- For concurrent requests: use a semaphore/queue per provider, not just counters
- Implement cooldown timers on 429 responses: when a 429 is received, mark that provider as unavailable until the `retry-after` header time (or a sensible default like 60 seconds)
- Don't try to predict token usage before a request -- track it after the response and use it for long-term quota management, not per-request routing
- Store rate limit state with timestamps, not just counts. "5 requests remaining as of 14:32:05" is more useful than "5 requests remaining"
- Accept imprecision: the goal is to be "mostly right" not "perfectly right." An occasional 429 that triggers waterfall is fine -- it's the expected path.

**Warning signs:**
- Proxy sends requests to providers that are clearly rate-limited
- Proxy skips providers that actually have capacity
- Rate limit tracking works for one provider but not another
- Debugging rate limit decisions requires reading logs with timestamps

**Phase to address:** Phase 2 (rate limit intelligence). Phase 1 should have simple reactive 429 handling (try, fail, waterfall). Phase 2 adds proactive tracking. Trying to build the full rate limit system in Phase 1 leads to over-engineering before you understand the real provider behaviors.

---

### Pitfall 5: The "OpenAI-Compatible" Contract Is Deeper Than /v1/chat/completions

**What goes wrong:** The proxy implements `/v1/chat/completions` and declares itself OpenAI-compatible, but real OpenAI SDK clients break because they expect other endpoints, specific header behaviors, or subtle response format details that the proxy doesn't support.

**Why it happens:**
- The OpenAI SDK makes requests to `/v1/models` during initialization or validation
- Some SDKs send `Organization` headers and expect them to not cause errors
- The SDK sets specific `User-Agent` headers and some code inspects them
- `stream_options: { include_usage: true }` is expected to add a final `usage` chunk in streaming responses
- The `finish_reason` field must be exactly `"stop"`, `"length"`, `"tool_calls"`, etc. -- not provider-specific values
- Error responses must match OpenAI's error schema exactly, including `type`, `code`, and `param` fields, or SDK error parsing breaks
- The `id` field in responses should be a unique string, and the `created` field should be a Unix timestamp. Some clients key on these.
- Streaming responses must include the `model` field in every chunk, not just the first one

**How to avoid:**
- Implement `/v1/models` endpoint that returns the chains/models available through the proxy
- Implement `/v1/chat/completions` with both streaming and non-streaming
- Match OpenAI's response schema exactly, field by field. Read the OpenAI API reference as your contract spec.
- Normalize all provider responses to exact OpenAI format before sending to client
- Test with the official OpenAI Node.js SDK, Python SDK, and at least one other client (e.g., `curl`, LangChain)
- Return proper OpenAI-shaped error responses for all error cases, including proxy-internal errors
- Support the `stream_options` parameter

**Warning signs:**
- "Works with curl" but "breaks with the SDK"
- Error handling in client code can't parse proxy errors
- LangChain or similar frameworks fail to initialize with the proxy

**Phase to address:** Phase 1 (core proxy). The response contract is foundational.

---

### Pitfall 6: Secrets Leaked Through Logs, Errors, and Config

**What goes wrong:** Provider API keys end up in log files, error messages returned to clients, stack traces, or config files committed to git. For an open-source project where users self-host, this is especially dangerous because users may not realize their keys are being written to disk.

**Why it happens:**
- Error responses from providers include the request details, which include the `Authorization` header
- Logging the full request/response for debugging captures API keys in headers
- Config files with API keys get committed to git
- Stack traces in development mode expose internal state
- The web UI might display API keys in management interfaces

**How to avoid:**
- Never log full request headers. Redact `Authorization` and `api-key` headers in all logging.
- Never forward provider error response bodies to the proxy client without sanitization
- Store API keys separately from configuration (environment variables or encrypted at-rest file)
- Add `.env` and any key-containing files to `.gitignore` in the project template
- In the web UI, mask API keys after initial entry (show only last 4 characters)
- Implement a log sanitizer that strips anything matching common API key patterns before writing

**Warning signs:**
- `grep -r "sk-" logs/` finds matches
- Error responses to clients contain upstream provider URLs or auth details
- Config file examples in docs contain placeholder keys that look real

**Phase to address:** Phase 1 (from first line of code). Security hygiene is exponentially harder to retrofit.

---

### Pitfall 7: Connection and Memory Leaks from Abandoned SSE Streams

**What goes wrong:** The client disconnects (closes browser tab, cancels request, network drops) but the proxy keeps the upstream provider connection open, continuing to receive and discard SSE chunks. Over time, this leaks connections and memory, eventually crashing the proxy or exhausting the provider's rate limit on zombie requests.

**Why it happens:**
- The proxy opens a connection to Provider A and starts piping SSE chunks to the client
- The client disconnects, but `req.on('close')` is either not handled or fires unreliably
- The upstream fetch/request to the provider is not aborted
- `AbortController` is not wired up between the client request lifecycle and the upstream request
- In Node.js, unhandled stream errors can keep references alive, preventing garbage collection

**How to avoid:**
- Wire an `AbortController` to every upstream request. When the client disconnects (`req.on('close')`), call `controller.abort()`.
- Also handle `req.on('error')` for unexpected connection issues
- Set reasonable timeouts on upstream requests (e.g., 30s for first byte, 120s total)
- Implement a connection tracker that periodically logs active upstream connections for monitoring
- Use `res.on('close')` as well as `req.on('close')` -- they fire in different scenarios
- Test with: start a streaming request, kill the client mid-stream, verify the upstream connection is cleaned up

**Warning signs:**
- Memory usage grows over time without returning to baseline
- Provider dashboards show more active requests than expected
- `process.memoryUsage()` rss climbs steadily
- "Too many open connections" errors after extended runtime

**Phase to address:** Phase 1 (core proxy SSE implementation). This is the #1 production stability issue for streaming proxies.

---

### Pitfall 8: JSON Config Files Become Unmanageable

**What goes wrong:** The project starts with a simple JSON config file for providers and chains. As features are added (rate limit overrides, per-provider settings, chain priorities, cooldown configs), the config file becomes deeply nested, hard to validate, and users constantly make formatting errors that cause cryptic startup failures.

**Why it happens:**
- JSON has no comments, so users can't annotate their config
- Deeply nested objects are hard to read and edit by hand
- No schema validation means a typo in a field name silently fails
- Adding new config fields requires migration logic for existing configs
- The config structure evolves as features are added, but there's no versioning

**How to avoid:**
- Use a schema validation library (e.g., Zod in TypeScript) to validate config at startup with clear error messages
- Consider YAML or TOML instead of JSON for the user-facing config (supports comments)
- Keep the config structure flat where possible. Prefer arrays of objects over deeply nested trees.
- Provide a `config.example.yaml` with extensive comments
- Validate config on startup and print human-readable errors with line numbers
- Version the config schema and provide migration between versions
- The Web UI should be the primary way to manage config, with the file as the persistence layer, not the editing interface.

**Warning signs:**
- GitHub issues about "config not working" or "invalid JSON"
- Config file exceeds 100 lines
- Users need documentation just to understand the config structure
- Adding a feature requires restructuring the config

**Phase to address:** Phase 1 (initial config design). The config schema is a contract with users that's hard to change once people depend on it.

---

### Pitfall 9: Testing Free Tiers Is Flaky and Unreliable

**What goes wrong:** Integration tests that hit real provider APIs are flaky because free tiers have unpredictable rate limits, go down for maintenance, change behavior, or get new restrictions. CI goes red frequently for reasons unrelated to code changes. Eventually, the team stops trusting or running the integration tests.

**Why it happens:**
- Free tiers are the lowest priority for providers -- they go down without notice
- Rate limits on free tiers are aggressive, so tests hit 429s during test runs
- Provider API behavior changes without versioning or notice on free tiers
- Tests depend on specific models being available, and models get removed from free tiers

**How to avoid:**
- Separate unit tests (fast, mock providers, run on every commit) from integration tests (real providers, run periodically or manually)
- Build comprehensive mocks that simulate real provider quirks (including 429s, malformed responses, slow responses, mid-stream disconnects)
- Record real provider responses and replay them in tests (HTTP cassette approach)
- Integration tests should be tagged and opt-in, not required for CI to pass
- Maintain a "provider health" test that runs on a schedule and reports which providers are currently working, but doesn't block releases
- When a test flakes, investigate and add the discovered quirk to the mock

**Warning signs:**
- CI is red more than 20% of the time
- Team members use `--skip-integration` habitually
- Bugs ship because they're in the integration-test-only path
- "It works locally" is a common phrase

**Phase to address:** Phase 1 (test architecture). Establishing the mock/unit boundary early prevents an untestable codebase later.

---

### Pitfall 10: Process Architecture -- Web UI and Proxy Server Fighting

**What goes wrong:** Running the web UI server and the proxy server in the same Node.js process causes them to interfere with each other. The UI's request handling blocks the event loop during a slow database query or template render, causing proxy latency spikes. Or the proxy's high connection count causes the UI to become unresponsive.

**Why it happens:**
- Node.js is single-threaded. CPU work in the UI (JSON serialization of large log datasets, config validation) blocks the proxy's SSE forwarding.
- The UI and proxy share the same memory space, so a memory leak in either affects both.
- Port conflicts and routing complexity when both need to serve HTTP.
- Restarting the UI to apply a config change also restarts the proxy, dropping all active streams.

**How to avoid:**
- Run them on separate ports from the start, even if in the same process. The proxy on port 4290, the UI on port 4291 (or similar).
- Use separate Express/Fastify app instances, not one app with route prefixes.
- Consider a clean separation where the UI communicates with the proxy via an internal API, not direct memory sharing.
- For v1 (single process), this is acceptable if you keep the UI lightweight. But design the boundary so they CAN be separated later.
- Avoid heavy synchronous operations in the UI (paginate logs, lazy-load data).
- If the UI needs to modify proxy state (add provider, change chain order), use an internal event emitter or API call, not direct mutation.

**Warning signs:**
- Proxy latency increases when the UI is under load
- Changing config in the UI drops active proxy connections
- Memory profiling shows UI-related allocations in the proxy's hot path
- "Restart to apply changes" for any config update

**Phase to address:** Phase 1 (architecture). The process boundary decision is foundational. Separate ports + separate app instances is low-cost insurance even if they share one `node` process.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but become costly.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcoded provider list (no adapter layer) | Faster initial development | Adding every new provider requires touching core routing code, increasing bug surface | Never -- the adapter pattern costs almost nothing to implement upfront |
| In-memory only rate limit tracking | No persistence complexity | All rate limit learning lost on restart; proxy hits 429s repeatedly after every restart | Acceptable for Phase 1 if you persist on graceful shutdown |
| String concatenation for SSE events | Simple to write | Malformed SSE events when content contains newlines or special characters; silent corruption | Never -- use a proper SSE serializer from day one |
| Single global error handler | Quick to implement | All errors treated the same; 429 (retry), 401 (config error), 500 (provider bug), and network timeout all need different handling | Phase 1 only, refactor in Phase 2 |
| Storing full request/response in logs | Great for debugging | Disk fills up fast with streaming responses; API keys in logs; 100MB+ log files within days | Only with log rotation and redaction from day one |
| Synchronous config file reads | Simple startup code | Blocks event loop if config is large; no hot-reload possible | Acceptable for startup, but reads during runtime must be async |
| Using `node-fetch` instead of native `fetch` | Wider Node.js version support | Extra dependency; `node-fetch` v3 is ESM-only which causes import headaches; native `fetch` (Node 18+) is the standard now | Only if supporting Node < 18 |
| Polling for rate limit reset instead of timers | Simpler mental model | Wastes CPU; delayed detection of available providers; inaccurate timing | Never -- use `setTimeout` based on reset timestamps |

---

## Integration Gotchas

Specific provider and protocol integration mistakes.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| OpenRouter | Assuming it's a single provider; it's an aggregator itself with pass-through rate limits from underlying providers | Treat OpenRouter rate limits as OpenRouter's limits, not the underlying model's. Parse `x-ratelimit-*` headers specifically for OpenRouter's format. |
| Groq | Sending unsupported parameters (e.g., `logprobs`, certain `tool_choice` values) causes 400 errors silently | Strip unsupported parameters in the Groq adapter before forwarding. Maintain a whitelist of supported params per provider. |
| Cerebras | Very aggressive rate limits on free tier; limits change frequently | Default to conservative rate limit assumptions. Update cooldown aggressively on 429. |
| SSE parsing | Splitting on `\n\n` to find SSE events; this breaks when chunks arrive split across TCP packets | Use a proper SSE parser that handles partial chunks, buffering until a complete event boundary is found. Libraries like `eventsource-parser` handle this correctly. |
| SSE `data: [DONE]` | Treating `[DONE]` as JSON and crashing on parse | Check for `[DONE]` string literal before attempting JSON.parse on SSE data fields |
| CORS | Not setting CORS headers, breaking browser-based clients | Set `Access-Control-Allow-Origin`, `Access-Control-Allow-Headers` (including `Authorization`), and handle preflight `OPTIONS` requests on all proxy endpoints |
| Content-Length | Setting `Content-Length` header on streaming responses | Never set Content-Length on SSE responses. Use `Transfer-Encoding: chunked` (which is the default when you don't set Content-Length). |
| Request timeout | Using a single timeout for both connection and response | Use separate timeouts: connection timeout (5-10s, for TCP handshake + TLS), first-byte timeout (15-30s, for provider to start responding), and total timeout (120-300s, for the full streaming response) |
| HTTPS/TLS | Proxy makes upstream requests but doesn't handle TLS certificate errors gracefully | Don't disable TLS verification. Handle certificate errors as provider connectivity issues and waterfall. |
| JSON parsing in streams | Using `JSON.parse()` without try-catch on SSE data | Always wrap JSON.parse in try-catch for every SSE chunk. Malformed chunks happen in production. Log and skip, don't crash. |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Logging every SSE chunk | Disk I/O becomes bottleneck; log files grow to GB in hours; event loop blocked by sync writes | Log request-level events only (start, end, error, provider selected). Never log individual chunks in production. Use a ring buffer for debug mode. | At moderate traffic (>10 concurrent streams) |
| Creating new HTTP connections per request | High latency from TLS handshake on every request; connection pool exhaustion | Use HTTP keep-alive and connection pooling (Node.js `http.Agent` with `keepAlive: true`). One agent per provider. | Immediately noticeable; adds 100-500ms per request |
| JSON.stringify on every chunk for logging/metrics | CPU spikes during high-throughput streaming | Defer serialization; collect metrics as numbers, serialize only when reporting | At >50 concurrent streams |
| Unbounded request queue | Memory grows without limit when all providers are rate-limited | Set a max queue depth. Return 503 to new requests when queue is full. Don't accept work you can't service. | When multiple providers are simultaneously rate-limited |
| Regex-based SSE parsing | Catastrophic backtracking on malformed events; CPU lock | Use a state-machine SSE parser or `eventsource-parser` library | On any malformed SSE event from a provider |
| Synchronous config validation on every request | Adds latency to every request; unnecessary re-parsing | Validate config once at load time. Cache parsed config in memory. Invalidate on config change (file watch or API call). | At any meaningful traffic level |
| Tracking per-token metrics in hot path | Event loop blocked by metric calculations during streaming | Aggregate tokens per-request, update metrics after stream completes, not per-chunk | At >20 concurrent streams |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| API keys in config.json committed to git | Key compromise; unauthorized usage of user's provider accounts; financial liability on paid tiers | Use environment variables or a separate `.env` file. Add config files with keys to `.gitignore`. Document this prominently. Provide `config.example.json` without real keys. |
| Proxy API key transmitted without TLS | MITM can capture proxy access key and abuse the proxy | Default to HTTPS in production. Warn loudly in logs if running HTTP on non-localhost. Provide easy HTTPS setup (Let's Encrypt integration or reverse proxy docs). |
| No rate limiting on the proxy itself | An attacker or misconfigured client can exhaust all provider rate limits in minutes | Implement per-client rate limiting on the proxy endpoint. Even with API key auth, a single client shouldn't be able to drain all providers. |
| Provider API keys accessible via Web UI API | Any user who can access the UI can extract API keys | The UI API should never return full API keys. Return masked versions only. Require re-authentication for sensitive operations. |
| Upstream provider URLs in client error responses | Information disclosure about which providers are configured | Normalize all error responses. Never expose upstream URLs, status codes, or error details to the proxy client. Log them server-side. |
| No input validation on proxy requests | Malformed or oversized requests forwarded to providers; potential for injection if providers have vulnerabilities | Validate request body schema, enforce max token limits, reject obviously malformed requests before forwarding |
| Web UI served without authentication | Anyone on the network can manage the proxy, view logs, extract (masked) API keys | Require authentication for all Web UI routes. Even a simple shared password is better than nothing. |
| Log files accessible via Web UI without auth | Full request logs viewable by anyone | Serve logs only through authenticated API endpoints. Never serve raw log files via static file serving. |

---

## "Looks Done But Isn't" Checklist

Things that appear to work in development but fail in production or real usage.

- [ ] **SSE streaming "works" but only tested with curl** -- Test with the OpenAI Node SDK `stream: true` and Python SDK `stream=True`. They parse SSE differently than raw HTTP clients.
- [ ] **Waterfall "works" but only tested with non-streaming requests** -- Streaming waterfall has fundamentally different constraints (can't retry mid-stream). Test the boundary between "pre-stream waterfall" and "mid-stream failure."
- [ ] **Rate limit tracking "works" but only with one concurrent request** -- Send 10 concurrent requests and verify the rate limit state is consistent. Race conditions are invisible with sequential testing.
- [ ] **Config validation "works" but only on happy path** -- Try: missing required fields, wrong types, empty arrays, duplicate provider names, circular chain references, extremely long model names, unicode in provider names.
- [ ] **Provider adapter "works" but only for chat completions** -- The `/v1/models` endpoint, error responses, and non-standard parameters all need testing per-provider.
- [ ] **The proxy "works" but hasn't been tested behind a reverse proxy** -- nginx and Cloudflare both affect SSE streaming. Test with both. Document the required nginx config.
- [ ] **Logs "work" but haven't been tested with high volume** -- Run 100 requests and check: log file size, disk usage, log rotation, whether logging blocks the event loop.
- [ ] **Graceful shutdown "works" but hasn't been tested with active streams** -- Send SIGTERM while 5 streams are active. Do active streams complete? Are rate limit counters persisted? Does the process actually exit?
- [ ] **Docker deployment "works" but only the happy path** -- Test: config file mounted as volume, environment variable injection, container restart preserving state, health checks, log access from host.
- [ ] **Web UI "works" but hasn't been tested with many providers/chains** -- 15 providers x 3 models each = 45 chain entries. Does the UI scroll? Does it become slow? Can you still find things?

---

## Recovery Strategies

When things go wrong, how to recover.

### All providers simultaneously rate-limited
**Detection:** Every provider in the chain returns 429 or is in cooldown.
**Recovery:** Return 429 to the client with a `Retry-After` header set to the minimum reset time across all providers. Do NOT queue the request indefinitely. The client should implement its own retry logic.
**Prevention:** Diversify the chain across many providers. Stagger usage rather than round-robining which exhausts all providers at similar times.

### Provider API key revoked or invalid
**Detection:** 401/403 from a provider that previously worked.
**Recovery:** Mark the provider as "unhealthy" (not just rate-limited). Waterfall to next. Surface the error in the Web UI dashboard as a persistent alert, not just a log entry.
**Prevention:** Validate all provider API keys on startup and periodically. Surface "API key invalid" alerts prominently.

### Corrupt config file
**Detection:** Startup fails with JSON parse error or schema validation error.
**Recovery:** Keep a backup of the last valid config. If the current config fails validation, offer to use the backup. Print the specific validation error with line number.
**Prevention:** The Web UI should be the primary config editing mechanism, not hand-editing the file. The UI validates before saving.

### Memory leak in long-running process
**Detection:** RSS memory grows over hours/days without returning to baseline.
**Recovery:** Implement a health check endpoint that includes memory usage. Set up alerts. Document recommended restart schedule if leak is unfixed.
**Prevention:** Proper cleanup of SSE connections (AbortController), bounded log buffers, bounded metrics history, periodic forced GC logging in development.

### SSE stream corruption
**Detection:** Client receives malformed JSON in SSE events, or events arrive with missing data fields.
**Recovery:** The proxy should validate outgoing SSE events before sending. If a provider sends a malformed chunk, log it and skip it rather than forwarding corruption.
**Prevention:** The response normalization layer should validate every chunk against the OpenAI SSE schema before forwarding.

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| SSE buffering (Pitfall 1) | Phase 1: Core proxy | Test streaming with OpenAI SDK (not just curl); verify TTFT < 100ms overhead |
| Mid-stream failover impossibility (Pitfall 2) | Phase 1: Architecture design | Document the constraint. Test that pre-stream waterfall works. Test that mid-stream failures send error events. |
| Provider API inconsistencies (Pitfall 3) | Phase 1: Provider adapter layer | Integration tests per provider. Adapter interface enforced by TypeScript types. |
| Rate limit state complexity (Pitfall 4) | Phase 1: Simple reactive (429 = cooldown). Phase 2: Proactive tracking from headers. | Load test with concurrent requests. Verify correct provider skipping. |
| OpenAI SDK compatibility (Pitfall 5) | Phase 1: Response format | Automated tests using official OpenAI Node.js SDK as the client |
| Secret leakage (Pitfall 6) | Phase 1: From first line of code | Security review checklist. `grep` for key patterns in logs. |
| Connection/memory leaks (Pitfall 7) | Phase 1: SSE implementation | Long-running soak test. Memory profiling. Client-disconnect test. |
| Config complexity (Pitfall 8) | Phase 1: Config schema design | Zod schema validation. Config example with comments. Schema versioning. |
| Test reliability (Pitfall 9) | Phase 1: Test architecture | Separate unit and integration test suites. Mock provider library. |
| Process architecture (Pitfall 10) | Phase 1: Initial architecture | Separate ports for proxy and UI. Latency testing under UI load. |

---

## Sources

**Note:** Web search and web fetch were unavailable during this research session. All findings are based on training data knowledge (cutoff: May 2025) of the following:

- LiteLLM project architecture and GitHub issues (HIGH confidence for architectural patterns)
- Portkey AI Gateway design and documentation (MEDIUM confidence)
- OpenAI API specification and SDK behavior (HIGH confidence)
- Node.js SSE streaming behavior and common issues (HIGH confidence)
- General proxy server architecture patterns (HIGH confidence)
- Provider-specific API behaviors for OpenRouter, Groq, Cerebras (MEDIUM confidence -- these may have changed post-training)
- Free tier rate limit behaviors (LOW confidence -- these change frequently and must be validated against current provider documentation)

**Validation recommended for:**
- Current provider rate limit header formats (especially OpenRouter and Cerebras)
- Current Groq API parameter support
- Current `eventsource-parser` library API (verify npm package name and version)
- Node.js native `fetch` capabilities in current LTS version
- Any specific version numbers mentioned in STACK recommendations

---
*Pitfalls research for: AI inference proxy/aggregator (429chain)*
*Researched: 2026-02-05*
