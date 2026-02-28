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

---
---

# v1.1 SaaS Multi-Tenancy Pitfalls

**Domain:** Adding Supabase Auth + Postgres RLS multi-tenancy to existing single-user Node.js proxy app
**Researched:** 2026-03-01
**Confidence:** HIGH (critical and security pitfalls verified against official Supabase docs, Bytebase RLS footguns article, pgbouncer docs, and AWS multi-tenant RLS guide)

These pitfalls are specific to the v1.1 milestone: retrofitting multi-tenant SaaS onto the existing single-user 429chain codebase.

---

## Critical Pitfalls (SaaS Milestone)

---

### SaaS Pitfall 1: Self-Hosted Mode Broken by Unconditional Supabase Imports

**What goes wrong:**
Adding `import { createClient } from '@supabase/supabase-js'` in any module that self-hosted mode also loads causes self-hosted deployments to either fail to start (missing env vars crash on initialization) or silently attempt Supabase connections and throw at runtime. The existing self-hosted mode has zero Supabase dependency — any unconditional Supabase import in a shared module breaks that guarantee. In TypeScript ESM, top-level `import` statements are evaluated eagerly, so there is no lazy fallback.

**Why it happens:**
Development happens in SaaS mode. Supabase imports naturally migrate into shared modules (middleware, route files, DB utilities) over time as the developer adds features without switching to test self-hosted mode. The self-hosted path is not re-tested until deployment.

**How to avoid:**
All Supabase-specific code must live exclusively in modules inside a `db/supabase/` (or equivalent) directory that is only imported when `DEPLOYMENT_MODE=saas`. Use dynamic `import()` — lazy imports — for Supabase modules at the factory/entry-point level. The DB abstraction factory (`createRepository()`) is the single conditional branch point. Self-hosted mode must never reach any code that imports from `@supabase/supabase-js`. Add a CI matrix job that runs the full test suite with `DEPLOYMENT_MODE=self-hosted` and no Supabase env vars defined.

**Warning signs:**
- `grep -r "@supabase/supabase-js" src/` returns hits outside `db/supabase/` or `saas/` modules
- No CI matrix entry for `DEPLOYMENT_MODE=self-hosted`
- Self-hosted Docker tests were last run before any SaaS code was written

**Phase to address:**
Very first phase — dual-mode architecture. The conditional import structure must be established before any SaaS code is written. This is a foundational decision, not a retrofit.

---

### SaaS Pitfall 2: Global service_role Supabase Client Bypasses RLS on All Paths

**What goes wrong:**
The `service_role` key bypasses all RLS policies in Postgres. If any server-side code path uses a `service_role` Supabase client where a user-scoped client should be used, that path reads and writes data across all tenants without restriction. The bug is invisible — it works correctly. It is only discovered when a cross-tenant data leak is reported. For 429chain, any route handler that touches providers, chains, usage logs, or API keys using a service_role client silently serves data from every tenant.

**Why it happens:**
It is easier to initialize one global `service_role` client for convenience during development. The problem is masked because tests only assert that user A can see user A's data — they do not assert that user A cannot see user B's data.

**How to avoid:**
Establish a hard structural rule: the `service_role` client is only initialized in explicitly named admin functions (e.g., `createUserOnSignup()`). All request-scoped operations use a per-request client initialized with the user's JWT, constructed inside Hono middleware and injected into the request context via `c.set('db', client)`. The per-request client must never be a module-level singleton. Write a cross-tenant isolation test: create user A and user B, insert providers for user A, query as user B, assert zero rows returned.

**Warning signs:**
- A module-level `const supabase = createClient(..., SUPABASE_SERVICE_ROLE_KEY)` accessible from route handlers
- No test that asserts user A cannot read user B's providers, chains, or API keys
- All Supabase client initialization in the codebase uses `SUPABASE_SERVICE_ROLE_KEY`

**Phase to address:**
Early architectural — Supabase client initialization pattern must be decided and enforced before any routes are written for SaaS mode.

---

### SaaS Pitfall 3: auth.uid() Returns NULL Silently — No Unauthenticated Guard

**What goes wrong:**
When a server-side request reaches Postgres without a valid JWT in the session context, `auth.uid()` returns `NULL`. A policy like `USING (auth.uid() = user_id)` evaluates as `NULL = user_id`, which is always false in SQL — so the query silently returns zero rows instead of throwing an error. Server-side code paths (background queue workers, scheduled tasks, admin routes) that skip JWT injection return empty datasets rather than visible errors. The bug is invisible until a developer or user notices missing data.

**Why it happens:**
Developers always test while authenticated. `auth.uid()` has a valid value in every test scenario. Unauthenticated server-side paths are never tested and the "empty result" failure mode looks like a data issue, not an auth issue.

**How to avoid:**
Add `TO authenticated` to every RLS policy so that it never evaluates for the `anon` role at all. Also add explicit null guards: `USING (auth.uid() IS NOT NULL AND auth.uid() = user_id)`. Write at least one test per protected endpoint that makes an unauthenticated request and asserts a 401/403 response at the application layer — before the DB query runs at all.

**Warning signs:**
- RLS policies that don't specify a `TO` role clause
- Integration tests that only test authenticated paths
- A protected API endpoint returns `[]` (empty array) rather than `401` when called without a token
- Queue processors or background jobs that make DB queries without constructing a JWT context

**Phase to address:**
DB schema and RLS design — early. Set the `TO authenticated` requirement and null guards in every policy during schema creation.

---

### SaaS Pitfall 4: USING Without WITH CHECK Allows Cross-Tenant Data Injection

**What goes wrong:**
A RLS policy with only a `USING` clause filters what rows a user can read and which rows are affected by UPDATE/DELETE. For INSERT, `USING` has no effect — only `WITH CHECK` controls what values can be written. Without `WITH CHECK`, a user can INSERT a row with another tenant's `user_id`, injecting data into a tenant's namespace they do not own. The attacker cannot read that data (the read policy blocks it), but it corrupts the other tenant's dataset silently.

**Why it happens:**
The most common RLS tutorial shows `USING (auth.uid() = user_id)` and stops there. The `WITH CHECK` clause is underexplained. The distinction between read-side and write-side enforcement is non-obvious because they feel like the same thing.

**How to avoid:**
Every table policy that permits INSERT or UPDATE must include `WITH CHECK (auth.uid() = user_id)`. The canonical pattern for a per-tenant table:

```sql
CREATE POLICY "tenant_isolation" ON providers
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

Run Supabase's Security Advisor in the dashboard after every schema change. Write a test that attempts to INSERT a row with a `user_id` set to a different user's UUID and asserts the operation is rejected with an RLS error.

**Warning signs:**
- RLS policies using `FOR ALL` with only a `USING` clause and no `WITH CHECK`
- Supabase Security Advisor has not been run against the schema
- No insert test that attempts cross-tenant user_id injection

**Phase to address:**
Schema creation — very early. `WITH CHECK` must be present from the first migration, not added as a security retrofit.

---

### SaaS Pitfall 5: Pgbouncer/Supavisor Transaction Mode Causes Session Variable Leakage Between Tenants

**What goes wrong:**
Supabase uses Supavisor in transaction pooling mode by default. In transaction pooling, a `SET` (session-level) command persists on a pooled connection after the transaction ends and the connection is returned to the pool. If request A sets `request.jwt.claims` to tenant A's JWT via `SET`, then the connection is returned to the pool, and request B from tenant B gets that same physical connection — `auth.uid()` now returns tenant A's user ID for tenant B's query. This is a silent cross-tenant data leak that only occurs under concurrent load in production.

**Why it happens:**
Local development uses a direct connection (no pooler) where session variables are connection-scoped and safe. The bug is invisible in local or low-traffic testing. It surfaces only under production load or staging with Supavisor.

**How to avoid:**
Always use `SET LOCAL` (not `SET`) to scope variables to the current transaction. `SET LOCAL` automatically reverts when the transaction ends, making it safe with connection poolers. When using the Supabase JS SDK with `.auth.setSession()`, PostgREST handles this correctly. When using a direct Postgres driver, every tenant-scoped DB call must be wrapped in an explicit transaction that uses `SET LOCAL`:

```sql
BEGIN;
SELECT set_config('request.jwt.claims', $1, true); -- third arg true = SET LOCAL
-- your query
COMMIT;
```

Add a concurrent-request integration test that fires requests from two different users simultaneously and asserts neither sees the other's data.

**Warning signs:**
- Direct Postgres driver usage alongside Supabase with `SET` (not `SET LOCAL`) for JWT claims
- Tests run against a direct connection only, not against Supavisor
- No concurrent cross-tenant test in the integration suite

**Phase to address:**
Early architectural — DB abstraction layer design. Establish `SET LOCAL` as the mandatory pattern before any repository implementations are written.

---

### SaaS Pitfall 6: SSE Streaming Connections Carry an Expiring JWT — Mishandled Mid-Stream

**What goes wrong:**
429chain's existing SSE streaming already works for proxying AI responses. In SaaS mode, the incoming request's JWT (default 1-hour expiry in Supabase) may expire during a long-running AI call. Two failure modes exist: (1) If the JWT is re-validated on each streamed chunk, a long stream is interrupted mid-response with a 401, corrupting the client's output. (2) If DB writes that happen mid-stream (token logging, usage tracking) re-initialize a Supabase client per chunk, each write hits the Supabase Auth API with a network round-trip, adding 50-200ms of latency per chunk.

**Why it happens:**
Standard HTTP auth middleware validates once at request entry. Developers assume this pattern extends to streaming. Supabase's `getUser()` (which makes a network call) gets placed inside the streaming loop because it is the "safe" way to validate freshness, without realizing it fires on every chunk.

**How to avoid:**
Validate the JWT exactly once at stream connection establishment (in the Hono middleware before the stream starts). Store the validated `userId` in the request context closure for the duration of the stream. All mid-stream DB writes use this stored `userId` directly — they do not re-validate or re-construct a Supabase client. Use `getClaims()` (local signature validation, no network call) for the initial check; `getUser()` (network call) is only needed for session-sensitive operations at connection start. The 1-hour JWT window is sufficient for any single AI response stream.

**Warning signs:**
- `supabase.auth.getUser()` called inside the SSE streaming loop or per-chunk DB write path
- A new Supabase client initialized per streamed chunk
- No test for a streaming request that writes to the DB mid-stream (token logging)

**Phase to address:**
Auth + streaming integration phase. Must be explicitly designed when wiring Supabase auth into the existing Hono SSE proxy handler — not added as an afterthought.

---

### SaaS Pitfall 7: DB Abstraction Interface Leaks Postgres-Specific Behavior

**What goes wrong:**
The dual-mode repository abstraction defines an interface. The Postgres/Supabase implementation adds return shapes, error types, or behaviors that only exist in Postgres (e.g., `upsert` with `onConflict`, `RETURNING *` semantics, Supabase-specific `PostgrestError` codes). Business logic or route handlers begin depending on these behaviors. The SQLite implementation cannot match them exactly, so self-hosted mode returns different data shapes or throws different errors — breaking the self-hosted path silently.

**Why it happens:**
The SaaS implementation is developed first and more heavily exercised. Postgres capabilities leak upward into service layer code that calls the repository. The abstraction boundary erodes without anyone noticing because only one implementation is tested at a time.

**How to avoid:**
Define the repository interface first, independently of both backends. Any operation the interface cannot express equivalently in both SQLite and Postgres must either be excluded from the interface or abstracted into a DB-agnostic operation. Run the full test suite against both implementations in CI — a separate CI matrix job per database backend. Any test that passes Postgres but fails SQLite is an abstraction leak.

**Warning signs:**
- Repository interface methods have Supabase-specific return types (`PostgrestResponse<T>`, `PostgrestError`)
- Service layer code catches `PostgrestError` directly
- Tests only run against one DB implementation
- Self-hosted integration test suite is skipped or broken after SaaS work begins

**Phase to address:**
Dual-mode architecture — the very first phase. Interface design must precede both implementations.

---

### SaaS Pitfall 8: BYOK Provider API Keys Stored as Plaintext

**What goes wrong:**
Each tenant stores their own provider API keys (OpenRouter, Groq, Cerebras). Stored as plaintext in the `providers` table, a single RLS misconfiguration — wrong policy, accidental service_role exposure, a SECURITY DEFINER view, or a future bug — exposes all tenants' provider credentials in one incident. Provider API keys often have billing implications and high-value rate limits attached to them.

**Why it happens:**
RLS is the security layer and feels sufficient. Application-layer encryption adds complexity for an MVP. The risk is underestimated because "RLS should protect it." Defense in depth is considered over-engineering.

**How to avoid:**
Encrypt provider API keys at the application layer before writing to Postgres. The plaintext key never leaves the server process. Decryption happens only in the request context when a provider key is needed. Options in order of implementation simplicity: (1) Supabase Vault (built-in secret manager, keys stored outside the database), (2) AES-256-GCM encryption in the repository layer using a server-side `ENCRYPTION_KEY` env var. Even if RLS is misconfigured or the database is compromised, leaked values are ciphertext.

**Warning signs:**
- Provider API keys readable as plaintext from the Supabase dashboard table editor
- The `api_key` column is type `text` with no application-layer transformation
- No encryption/decryption step in the provider save and fetch code paths

**Phase to address:**
Schema design — early. Encryption strategy must be decided at schema creation, not retrofitted after keys are already stored.

---

### SaaS Pitfall 9: Unique Constraints Without Tenant Scoping Leak Data Existence

**What goes wrong:**
A global unique index on a column like `name` or `slug` leaks data existence across tenants. When user B attempts to create a provider named "my-groq" and user A already has one with that name, the INSERT fails with a "duplicate key" constraint violation — revealing to user B that a record with that name exists somewhere in the system, even though RLS prevents user B from reading user A's data.

**Why it happens:**
Uniqueness constraints are added for correctness without considering tenant scoping. The developer tests in isolation (one user, no cross-tenant conflicts) and the leakage is not discovered until a security review.

**How to avoid:**
Scope all uniqueness constraints to include `user_id`: `UNIQUE (user_id, name)` not `UNIQUE (name)`. This permits two different tenants to have a provider with the same name, which is the correct behavior for a multi-tenant system.

**Warning signs:**
- Unique constraints on user-created entity names that do not include `user_id` as a component
- No test that creates the same named resource as two different users and verifies both succeed

**Phase to address:**
Schema design — during migration creation. Review every `UNIQUE` constraint for tenant scope before applying.

---

## SaaS Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Global `service_role` Supabase client | Simple initialization, works everywhere | Bypasses RLS for all tenants on every code path that uses it | Never — always scope to request context |
| Skip `WITH CHECK` in RLS policies | Simpler policies, tutorials omit it | Cross-tenant data injection possible on INSERT | Never |
| `SET` instead of `SET LOCAL` for JWT claims | Slightly less boilerplate | Session variables leak across pooled connections under concurrent load | Never when using Supavisor/PgBouncer |
| Test only against Postgres in CI | Easier test setup | SQLite self-hosted mode breaks silently as abstraction leaks | Never — self-hosted is a supported deployment mode |
| Plaintext provider API key storage | No extra crypto code | Single RLS bug exposes all tenants' third-party API credentials | Local dev only; never in SaaS production |
| Supabase imports in shared modules | Convenient access | Self-hosted mode fails to start with missing env vars | Never — isolate to mode-specific modules via dynamic import |
| `getUser()` (network call) in every request | Always-fresh session validation | 50-200ms added latency per request from Supabase Auth network round-trip | Only for explicitly session-sensitive operations, not proxy hot path |

---

## SaaS Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Supabase Auth + Hono middleware | Calling `supabase.auth.getUser()` (network call) on every request | Use `getClaims()` for local JWT signature validation; only call `getUser()` when session freshness is required |
| Supabase JS SDK + server-side | Using `getSession()` server-side (trusts client-provided unverified session data) | Use `getClaims()` or `getUser()` server-side; `getSession()` is designed for client-side |
| Supabase RLS + Supavisor | Using `SET` (session-level) for JWT claims context when using a direct driver | Use `SET LOCAL` inside an explicit transaction for all tenant context variables |
| Supabase Auth + SSE streaming | Re-validating JWT or calling `getUser()` inside the streaming loop | Validate JWT once at stream start, store `userId` in closure, use it for all mid-stream DB writes |
| Supabase anon key vs service_role | Using `service_role` client in route handlers, or `anon` key with no RLS | `anon` key + RLS for user-facing requests; `service_role` only in explicit admin code paths |
| SECURITY DEFINER views | Views created with raw SQL in Supabase inherit no RLS protection | Use `security_invoker = true` (Postgres 15+); Supabase applies this to views created via table editor but not raw SQL |
| Hono middleware + dual mode | Auth middleware that unconditionally imports Supabase | Compose middleware conditionally based on `DEPLOYMENT_MODE` at startup |
| Supabase asymmetric JWT keys | Using old symmetric-key validation logic with new asymmetric keys (default from May 2025) | Use `getClaims()` from `@supabase/ssr` or verify against Supabase's published public keys, not a shared secret |

---

## SaaS Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Non-LEAKPROOF functions in RLS policies | Query time grows from ms to seconds on large tables | Use only LEAKPROOF built-ins (`auth.uid()`, `=`, `AND`) in policies; no custom PL/pgSQL functions | At ~10K rows per tenant |
| Missing index on `user_id` column in RLS policies | Sequential scans on every query; latency linear with table size | `CREATE INDEX ON providers (user_id)` and similar for every tenant-isolated table | At ~1K rows per table |
| `getUser()` called per request (network round-trip) | 50-200ms added to every API request | Use `getClaims()` for local validation in the hot path | At 10+ concurrent users |
| Complex subqueries in RLS policies | `EXPLAIN ANALYZE` shows nested loop on every row | Denormalize `user_id` into child tables; avoid JOIN-heavy policies | At ~100 rows with complex joins |

---

## SaaS Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Exposing `service_role` key in client bundle or Vite env vars | Full database access bypassing all RLS — complete tenant data exposure | Server-side only; never prefix with `VITE_`; never in environment variables accessible to the browser |
| Using `user_metadata` claims in RLS policies | Users can modify `user_metadata`; policy enforcement can be bypassed by self-modifying claims | Use only `auth.uid()` (the `sub` claim) in RLS; `user_metadata` is user-writable |
| Materialized views over tenant data | Materialized view refresh runs as superuser, copying all tenant data; RLS does not protect the materialized copy | Avoid materialized views over tenant tables; use regular views with `security_invoker = true` |
| Provider API keys logged in request logs | Provider keys appear in plaintext in log aggregators | Redact all credential fields from logging; sanitize provider config objects before any log write |
| Unique constraints without tenant scope | Global uniqueness error reveals that a named resource exists in another tenant | Scope all uniqueness: `UNIQUE (user_id, name)` not `UNIQUE (name)` |

---

## SaaS UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No distinction between "session expired" and "wrong provider key" in proxy 401 responses | Users cannot tell whether to re-login or check their provider API key | Return structured error codes: `auth_required` (session issue) vs `provider_key_invalid` (BYOK issue) |
| Self-hosted users see Supabase error strings in logs or UI | Confusing references to Supabase in a self-hosted deployment | Error messages must be mode-aware; never surface Supabase-specific strings in self-hosted mode |
| Signup requires email confirmation but UI gives no feedback | User completes signup, cannot log in, assumes the product is broken | Show explicit "check your email" UI with retry option; or disable email confirmation for initial SaaS launch |
| No session persistence across tab close | User returns to the app and must re-login, losing their place | Use Supabase's persistent session storage (localStorage or secure cookies) correctly; do not use in-memory-only session |
| Self-hosted mode breaks when partial Supabase env vars are present | Existing self-hosted deployments fail if a user accidentally copies Supabase config | Mode detection must be explicit via a single `DEPLOYMENT_MODE=saas|self-hosted` env var, not inferred from presence of Supabase vars |

---

## SaaS "Looks Done But Isn't" Checklist

- [ ] **RLS enabled on every table:** `ALTER TABLE x ENABLE ROW LEVEL SECURITY` on every tenant-data table — verify with Supabase Security Advisor, not just by testing the happy path
- [ ] **WITH CHECK present:** Every INSERT/UPDATE policy has a `WITH CHECK` clause — verify by attempting to insert a row with a different `user_id` and confirming it is rejected
- [ ] **Self-hosted mode tested:** CI runs full test suite with `DEPLOYMENT_MODE=self-hosted` and no `SUPABASE_*` env vars — verify CI matrix configuration
- [ ] **Cross-tenant isolation tested:** At least one test creates two users, inserts data as user A, queries as user B, asserts zero rows returned
- [ ] **SSE auth validated for streaming:** A test that starts a streaming request and confirms the correct `user_id` is used for all DB writes throughout the stream
- [ ] **service_role client scoped:** No `service_role` Supabase client accessible from route handlers — verify by checking initialization scope in code
- [ ] **Provider keys not plaintext:** The `api_key` column is not readable as plaintext from the Supabase dashboard table editor
- [ ] **Supabase imports isolated:** `grep -r "@supabase/supabase-js" src/` returns results only in files within a `db/supabase/` or equivalent Supabase-specific module directory
- [ ] **Unique constraints tenant-scoped:** Every unique constraint on user-created entities includes `user_id` as a component — verified in migration files

---

## SaaS Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| RLS not enabled discovered post-launch | HIGH | Enable RLS immediately (blocks all anon requests); add policies iteratively; audit logs for cross-tenant queries; notify affected users |
| service_role key exposed in client bundle | HIGH | Rotate key immediately in Supabase dashboard; audit for unauthorized access; re-deploy |
| Cross-tenant data injection via missing WITH CHECK | MEDIUM | Add WITH CHECK policies; audit affected tables for injected rows (`WHERE user_id != auth.uid()`); clean up orphaned rows |
| Self-hosted mode broken by Supabase imports | MEDIUM | Refactor to lazy dynamic imports for Supabase modules; add CI matrix for self-hosted mode; no data loss |
| Session variable leakage in production (SET not SET LOCAL) | HIGH | Emergency deploy with SET LOCAL; audit Postgres logs for cross-tenant auth.uid() anomalies |
| Provider API keys stored plaintext | MEDIUM | Add encryption at application layer; migrate existing keys through encryption transform; no re-key of Supabase credentials needed |
| DB abstraction interface leaked | MEDIUM | Freeze interface contract; fix implementations to match; add cross-implementation test suite; no data loss but potentially a breaking API change |

---

## SaaS Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Self-hosted mode broken by Supabase imports | Dual-mode architecture (first phase) | CI matrix: `DEPLOYMENT_MODE=self-hosted` with zero Supabase env vars passes all tests |
| DB abstraction interface leak | Dual-mode architecture (first phase) | CI: full test suite runs against both SQLite and Postgres implementations |
| service_role bypass on wrong paths | Supabase client initialization (first SaaS phase) | Code review: no `service_role` client in request handler scope |
| auth.uid() null silently returns empty rows | DB schema + RLS design | Test: unauthenticated request to protected endpoint returns 401, not empty array |
| USING without WITH CHECK | DB schema + RLS design | Test: INSERT with wrong user_id is rejected; Supabase Security Advisor passes |
| Unique constraints not tenant-scoped | Schema design | Test: two users can create a provider with the same name without error |
| JWT claims SET vs SET LOCAL leakage | DB abstraction layer design | Test: concurrent requests from two users never see each other's data |
| BYOK API keys stored plaintext | Schema design | Verification: `api_key` column not readable as plaintext from Supabase dashboard |
| SSE mid-stream auth misconfiguration | Auth + streaming integration phase | Test: streaming request uses consistent user_id for all DB writes throughout stream |

---

## SaaS Sources

- [Supabase RLS Official Docs](https://supabase.com/docs/guides/database/postgres/row-level-security) — auth.uid() null behavior, service role guidance, performance recommendations (HIGH confidence)
- [Supabase RLS Performance and Best Practices](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv) — index requirements, LEAKPROOF functions, role specification (HIGH confidence)
- [Common Postgres RLS Footguns — Bytebase](https://www.bytebase.com/blog/postgres-row-level-security-footguns/) — 16 concrete footguns including USING/WITH CHECK distinction, SECURITY DEFINER views, unique constraint data leakage (HIGH confidence)
- [Postgres RLS Implementation Guide — Permit.io](https://www.permit.io/blog/postgres-rls-implementation-guide) — asymmetric USING/WITH CHECK, session context leakage, superuser testing false confidence (MEDIUM confidence)
- [Multi-tenant data isolation with PostgreSQL RLS — AWS](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/) — connection pooling and SET LOCAL patterns (HIGH confidence)
- [PgBouncer is useful, important, and fraught with peril](https://jpcamara.com/2023/04/12/pgbouncer-is-useful.html) — transaction mode session variable leakage details (MEDIUM confidence)
- [Supabase Security Flaw: 170+ Apps Exposed by Missing RLS](https://byteiota.com/supabase-security-flaw-170-apps-exposed-by-missing-rls/) — CVE-2025-48757 real-world incident involving missing RLS in generated code (HIGH confidence, recent incident)
- [Supabase Auth Server-Side Advanced Guide](https://supabase.com/docs/guides/auth/server-side/advanced-guide) — getClaims() vs getUser() for server-side validation (HIGH confidence)
- [Supabase JWT and Sessions Docs](https://supabase.com/docs/guides/auth/sessions) — token expiry, refresh mechanics, 1-hour default JWT expiry (HIGH confidence)
- [Supabase Understanding API Keys](https://supabase.com/docs/guides/api/api-keys) — anon vs service_role scoping, key exposure risks (HIGH confidence)
- [Use Supabase with Hono — Official Quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/hono) — Hono-specific integration patterns (HIGH confidence)
- [RLS for Tenants in Postgres — Crunchy Data](https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres) — multi-tenant design patterns, performance indexing (MEDIUM confidence)

---
*v1.1 SaaS pitfalls for: Adding Supabase Auth + Postgres RLS multi-tenancy to 429chain*
*Researched: 2026-03-01*
