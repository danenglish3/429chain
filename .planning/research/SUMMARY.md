# Project Research Summary

**Project:** 429chain
**Domain:** AI inference proxy/aggregator
**Researched:** 2026-02-05
**Confidence:** MEDIUM-HIGH

## Executive Summary

429chain is an OpenAI-compatible AI inference proxy designed to maximize free-tier token usage through intelligent waterfall routing. The product sits in a unique market position: while LiteLLM and Portkey focus on paid-tier optimization, and OpenRouter is a closed SaaS aggregator, 429chain is the first open-source proxy laser-focused on extracting maximum value from free AI provider tiers through proactive rate-limit awareness.

The recommended approach is a layered architecture built on Node.js 20+, Hono (lightweight HTTP framework), and better-sqlite3 for persistence. The core differentiation lies in the waterfall engine: unlike competitors that reactively retry on failures, 429chain proactively tracks rate limits via response headers, implements provider cooldown timers, and intelligently skips exhausted providers before wasting requests. The architecture must handle SSE streaming as a first-class concern — this is both the most critical user experience feature and the most architecturally complex component.

The primary risks center on streaming complexity and provider inconsistencies. SSE buffering destroys user experience, mid-stream failover is architecturally impossible (unlike non-streaming requests), and "OpenAI-compatible" providers differ in dozens of subtle ways. Success requires: (1) building the provider adapter layer from day one to isolate quirks, (2) treating rate limit state as in-memory-first with periodic persistence, not synchronous disk reads, and (3) accepting that streaming requests cannot waterfall after chunks begin flowing — pre-stream validation is mandatory.

## Key Findings

### Recommended Stack

**Core Runtime:** Node.js 20+ LTS (native fetch, stable ESM, AbortController built-in) with TypeScript 5.5+ in strict mode.

**HTTP Framework:** Hono 4.x — purpose-built for proxy workloads with native SSE streaming helpers, middleware composition, and minimal footprint (~14KB). Runs on Node via `@hono/node-server`. Superior to Express (outdated, poor streaming) and lighter than Fastify for this use case.

**Persistence:** SQLite via better-sqlite3 11.x — synchronous API, zero-config, single-file database perfect for lightweight logs/stats/config. Drizzle ORM optional but recommended for typed queries. Avoid Prisma (heavyweight binary engine, slow cold starts).

**UI Stack:** React 18.x/19.x + Vite 5.x/6.x (SPA served as static files by Hono), TanStack Query for server state management, Tailwind CSS + shadcn/ui for components, Recharts for usage visualizations.

**Critical Libraries:** Zod for validation (requests, config, env vars), Pino for structured logging, native fetch for upstream requests (no axios/node-fetch needed), nanoid for ID generation, ms for time parsing.

**Avoid:** Express (poor TypeScript, no streaming), Axios (unnecessary, no streaming), Prisma (overkill), Redis (adds daemon dependency for minimal benefit at this scale), Next.js (massive complexity for a management SPA), MongoDB (violates lightweight constraint).

**Confidence:** HIGH on architectural choices (Hono, SQLite, React+Vite). MEDIUM on exact versions (based on May 2025 training data — verify latest before npm install).

### Expected Features

**Table Stakes (v1.0 requirements):**
- OpenAI-compatible `/v1/chat/completions` endpoint (streaming + non-streaming)
- Multi-provider support (minimum: OpenRouter, Groq, Cerebras)
- Waterfall routing on 429/failure with ordered provider chains
- Reactive rate limit learning (429 detection + cooldown timers)
- Basic proactive rate limit tracking (parse common x-ratelimit-* headers)
- API key gating for proxy access
- Request logging (provider used, tokens, latency, status)
- Health check endpoint (`/health`)
- Docker deployment with minimal config

**Differentiators (what makes 429chain unique):**
- **Intelligent rate-limit-aware waterfall** — proactive header parsing + reactive 429 learning + cooldown timers. No other open-source tool optimizes specifically for free-tier quota maximization.
- **Chain-level abstraction** — user defines named chains (ordered provider+model lists), proxy handles routing. Cleaner UX than LiteLLM's model groups.
- **Real-time usage dashboard** — visual display of per-provider quota status ("Groq: 28/30 RPM, resets in 42s").
- **Request cost tracking ($0 saved)** — "You saved $4.72 today" vanity metric validates product value.

**Anti-Features (explicitly out of scope):**
- Cost-optimized routing (irrelevant for free tiers, adds massive complexity)
- Semantic caching (low hit rates, stale response risk, adds complexity)
- Multi-user RBAC (massive scope creep for v1)
- Prompt transformation/middleware (prompt injection risks, debugging nightmare)
- Guardrails/content filtering (rely on provider-side filtering)
- Embedding/image/audio endpoints (v2+ at earliest)

**MVP Feature Set:** OpenAI-compatible chat endpoint, 3 provider adapters, chain config files, waterfall on 429, basic rate limit tracking, API key auth, request logging, health check, Docker deployment.

**Post-MVP (v1.x):** Web UI for provider/chain management, usage dashboard, test endpoint, SQLite persistence for historical stats, manual rate limit overrides, provider health monitoring.

**Confidence:** HIGH on table stakes and differentiators (well-established patterns). MEDIUM on anti-feature validation (based on LiteLLM/OpenRouter/Portkey training knowledge).

### Architecture Approach

**Pattern:** Layered gateway architecture with strict separation of concerns.

**Layer 1 (HTTP Surface):** Hono server with OpenAI-compatible endpoints, auth middleware, request validation, SSE response management, Web UI static serving.

**Layer 2 (Request Orchestration):** Chain resolution (which chain for this request?), waterfall execution loop (iterate through chain entries), retry/timeout logic, response normalization.

**Layer 3 (Provider Intelligence):** Rate limit tracking (proactive header parsing + reactive 429 detection), cooldown timers per provider+model, provider availability scoring.

**Layer 4 (Provider Adapters):** HTTP client per provider, request/response translation (OpenAI ↔ provider format), SSE stream passthrough/transformation, rate limit header extraction. Each provider gets an adapter class implementing `BaseProviderAdapter` interface.

**Layer 5 (Persistence):** Config file read/write (YAML/JSON), usage/stats logging, request history, in-memory state with periodic flush.

**Key Component Responsibilities:**
- **Chain Router:** Executes waterfall logic (iterate chain, check rate limits, call adapters, handle failures).
- **Rate Limit Tracker:** In-memory map of per-provider+model state (AVAILABLE → TRACKING → EXHAUSTED), updated from response headers and 429s.
- **Provider Adapter:** Normalizes provider-specific quirks (different header formats, error shapes, SSE chunk boundaries, model naming).
- **SSE Bridge:** Pipes upstream SSE responses to client with interception for token counting, handles mid-stream errors.

**Critical Design Decisions:**
- **Proactive provider skipping:** Check rate limit state BEFORE making requests. Without this, every request sequentially hits exhausted providers, adding latency.
- **Streaming constraint:** Once SSE streaming starts (first chunk sent), waterfall is impossible — HTTP response is committed. Pre-stream validation mandatory. Mid-stream failures send error events, don't retry.
- **In-memory rate limit state:** Persisting to disk on every request is a performance killer. Keep state in-memory, flush periodically (30s or on shutdown).
- **Event-driven side effects:** Usage tracking, logging, metrics use an event bus. Never block the critical request path.

**Anti-Patterns to Avoid:**
- Monolithic request handler (500-line route functions)
- Synchronous disk reads for rate limit checks
- Buffering full streaming responses
- Hard-coding provider logic (use adapter pattern)
- Tight coupling between proxy and dashboard
- Retry loops without circuit breaking

**Confidence:** HIGH (architecture patterns drawn from LiteLLM, Portkey, and standard API gateway designs).

### Critical Pitfalls

**Pitfall 1: SSE Streaming Buffering**
- **Risk:** Proxy buffers SSE chunks before forwarding, user sees "bursty" output instead of real-time tokens.
- **Cause:** Node.js HTTP response buffering, compression middleware, nginx `proxy_buffering on`, missing `flushHeaders()`.
- **Prevention:** Set SSE headers (`text/event-stream`, `no-cache`, `X-Accel-Buffering: no`), call `res.flushHeaders()` before first chunk, exclude SSE routes from compression, test with real OpenAI SDK not just curl.
- **Phase:** 1 (core proxy) — must be correct from day one.

**Pitfall 2: Waterfall During Active Streaming Is Impossible**
- **Risk:** Provider fails mid-stream, proxy wants to retry, but client already received partial response. Results in truncated/garbled output.
- **Cause:** SSE is append-only. Once bytes are sent, they cannot be unsent.
- **Prevention:** Accept this constraint. Waterfall BEFORE streaming begins. Send SSE error event for mid-stream failures. Pre-flight validation to avoid starting doomed streams.
- **Phase:** 1 (architecture) — waterfall design must account for this upfront.

**Pitfall 3: Provider "Compatibility" Is Full of Edge Cases**
- **Risk:** "OpenAI-compatible" providers differ in response formats, error shapes, header formats, SSE chunk boundaries. Each integration becomes whack-a-mole.
- **Cause:** Every provider has quirks (null vs empty string vs omitted fields, different rate limit headers, model name mapping).
- **Prevention:** Provider adapter layer from day one. Each adapter normalizes requests AND responses. Integration tests per provider. Parse SSE defensively.
- **Phase:** 1 (provider adapters) and ongoing iteration.

**Pitfall 4: Rate Limit State Is Complex**
- **Risk:** Tracking is inaccurate, leading to either wasted 429 attempts or skipping available providers.
- **Cause:** Multiple limit dimensions (RPM, RPD, TPM, TPD, concurrent), rolling vs fixed windows, race conditions, unknown limits on free tiers, missing headers.
- **Prevention:** Layered tracking (headers → 429 reactive → manual config). Cooldown timers on 429. Accept imprecision ("mostly right" is OK). Don't predict token usage pre-request.
- **Phase:** 1 (reactive 429 + cooldown), 2 (proactive header tracking).

**Pitfall 5: OpenAI SDK Expects More Than /v1/chat/completions**
- **Risk:** SDK clients break because they expect `/v1/models`, specific headers, exact error schema.
- **Cause:** SDK makes initialization calls to `/v1/models`, expects Organization headers not to error, requires exact `finish_reason` values, needs usage in final streaming chunk with `stream_options`.
- **Prevention:** Implement `/v1/models`, match OpenAI response schema exactly, test with official OpenAI Node.js/Python SDKs, normalize all error responses.
- **Phase:** 1 (core proxy).

**Pitfall 6: Secrets Leaked Through Logs/Errors/Config**
- **Risk:** Provider API keys end up in logs, error messages, or committed to git.
- **Cause:** Logging full request headers, returning provider errors to client, committing config files.
- **Prevention:** Redact `Authorization` headers in logs, never forward provider errors without sanitization, use `.env` for keys, mask keys in UI.
- **Phase:** 1 (from first line of code).

**Pitfall 7: Connection/Memory Leaks from Abandoned SSE Streams**
- **Risk:** Client disconnects mid-stream, proxy keeps upstream connection open, leaking memory and connections.
- **Cause:** Missing AbortController wiring, unhandled `req.on('close')`, upstream request not aborted on client disconnect.
- **Prevention:** Wire AbortController to every upstream request, handle `req.on('close')` and `req.on('error')`, set timeouts, test with client disconnect scenarios.
- **Phase:** 1 (SSE implementation) — #1 production stability issue for streaming proxies.

**Pitfall 8: JSON Config Files Become Unmanageable**
- **Risk:** Deeply nested config, no comments, cryptic startup errors from typos.
- **Cause:** No schema validation, JSON doesn't support comments, evolving config structure.
- **Prevention:** Use YAML for config (supports comments), Zod schema validation with clear error messages, keep structure flat, provide `config.example.yaml`, Web UI as primary config interface.
- **Phase:** 1 (config design).

**Pitfall 9: Testing Free Tiers Is Flaky**
- **Risk:** Integration tests hit real provider APIs, go red due to rate limits/downtime/behavior changes.
- **Cause:** Free tiers are low priority for providers, aggressive rate limits, unpredictable availability.
- **Prevention:** Separate unit tests (mock providers) from integration tests (real APIs, opt-in, not required for CI). Build comprehensive mocks simulating quirks. HTTP cassette approach for recorded responses.
- **Phase:** 1 (test architecture).

**Pitfall 10: Web UI and Proxy Server Process Conflicts**
- **Risk:** UI and proxy in same process, CPU work in UI blocks proxy event loop, memory leaks affect both.
- **Cause:** Node.js single-threaded, shared memory space, port conflicts.
- **Prevention:** Separate ports even if same process (proxy 4290, UI 4291). Separate Hono app instances. Design clean API boundary for eventual process separation.
- **Phase:** 1 (architecture).

**Confidence:** HIGH (pitfalls drawn from LiteLLM issues, Portkey architecture, and Node.js streaming best practices).

## Implications for Roadmap

### Phase Ordering Rationale

The architecture dependency graph dictates a strict build order. Foundation → Provider Layer → Core Engine → Proxy Endpoint → Streaming → Tracking → Admin API → Web UI → Polish.

**Why this order:**
1. **Foundation first:** Types, config schema, error classes, logger, event bus have zero dependencies. Everything else depends on these.
2. **Provider adapters before waterfall:** The chain router needs a clean provider interface. Adapters must be designed upfront to handle request translation, response normalization, and header extraction.
3. **Non-streaming before streaming:** Streaming adds architectural constraints (can't waterfall mid-stream, SSE buffering risks). Validate waterfall logic with non-streaming requests first.
4. **Tracking is parallel:** Usage collection hooks into request lifecycle via events, doesn't block core functionality. Can be added incrementally.
5. **Web UI last:** UI consumes stable APIs. Build admin API endpoints first, then UI on top.

### Suggested Phase Structure

**Phase 1: Core Waterfall Proxy (Non-Streaming)**
- **Rationale:** Prove the core value proposition (waterfall on 429) without streaming complexity.
- **Delivers:** Working OpenAI-compatible endpoint for non-streaming chat completions, waterfall routing, reactive 429 handling with cooldown.
- **Features:** Foundation (types, errors, logger, events), config schema (YAML + Zod validation), provider adapter layer (base class + generic OpenAI adapter), rate limit tracker (in-memory, simple cooldown on 429), chain router (waterfall logic), Hono server with auth middleware, `/v1/chat/completions` (non-streaming only), `/health` endpoint.
- **Pitfalls Addressed:** #3 (provider adapters), #5 (OpenAI schema compliance), #6 (secret redaction), #8 (config design), #9 (test architecture).
- **Phase Exit Criteria:** Send a request with 3 providers configured, first provider returns 429, proxy automatically tries second provider and returns success. All done without streaming.

**Phase 2: SSE Streaming Support**
- **Rationale:** Streaming is the expected UX for chat UIs. This is architecturally complex and must be isolated from Phase 1.
- **Delivers:** SSE streaming for chat completions, waterfall works pre-stream, graceful error handling mid-stream.
- **Features:** SSE parser/writer/bridge, streaming support in chain router (proactive provider validation before starting stream), AbortController wiring for client disconnect, streaming mode in provider adapters, test endpoint in Web UI for streaming validation.
- **Pitfalls Addressed:** #1 (SSE buffering), #2 (mid-stream failover constraint), #7 (connection leaks).
- **Phase Exit Criteria:** Stream a request through the proxy using the OpenAI Node SDK with `stream: true`. Verify TTFT < 100ms overhead. Kill the client mid-stream, verify upstream connection is cleaned up.

**Phase 3: Proactive Rate Limit Tracking**
- **Rationale:** Reactive 429 handling (Phase 1) works but wastes requests. Proactive tracking optimizes free-tier usage.
- **Delivers:** Header-based rate limit tracking, intelligent provider skipping before attempting requests.
- **Features:** Rate limit header parser per provider, AVAILABLE → TRACKING → EXHAUSTED state machine, cooldown timers based on reset timestamps (not just arbitrary delays), periodic state persistence to SQLite for restart recovery, provider health monitoring (error rates, latency trends).
- **Pitfalls Addressed:** #4 (rate limit state complexity).
- **Phase Exit Criteria:** Send 25 requests to a provider with 20 RPM limit. Verify the 21st request skips that provider proactively (no 429 attempt) and uses the next in chain.

**Phase 4: Persistence & Usage Tracking**
- **Rationale:** Users need visibility into what the proxy is doing. This phase adds observability.
- **Delivers:** Request logging to SQLite, usage stats aggregation, historical data for dashboard.
- **Features:** SQLite schema (Drizzle or raw SQL), request log table, usage collector (event-driven), stats aggregation (per-provider, per-chain, daily totals), log rotation, "money saved" metric.
- **Pitfalls Addressed:** None directly, but enables debugging future issues.
- **Phase Exit Criteria:** Run the proxy for 24 hours with realistic traffic. Query SQLite to get per-provider request counts, token usage, average latency.

**Phase 5: Web UI & Admin API**
- **Rationale:** Config file editing is clunky. Web UI makes the proxy accessible to non-technical users.
- **Delivers:** Browser-based dashboard for provider/chain management, live usage monitoring, request testing.
- **Features:** Admin API (CRUD for providers/chains, stats endpoints, test endpoint), React SPA (provider management page, chain editor with drag-to-reorder, usage dashboard with charts, test endpoint page), TanStack Query for server state, Recharts for visualizations, API key masking in UI.
- **Pitfalls Addressed:** #8 (config complexity — UI becomes primary interface), #10 (process separation — separate ports/apps).
- **Phase Exit Criteria:** Use only the Web UI to: add a new provider, create a chain with 3 entries, reorder the chain, send a test request, view the result and which provider handled it.

**Phase 6: Deployment & Polish**
- **Rationale:** The proxy works but needs production-ready deployment.
- **Delivers:** Docker image, docker-compose setup, npm CLI package, documentation.
- **Features:** Multi-stage Dockerfile, docker-compose with volume mounts for config/data, npm package with `npx 429chain` CLI, comprehensive README, config examples, provider setup guides, deployment guides (Docker, VPS, local), health check integration with Docker.
- **Pitfalls Addressed:** None new, but validates all previous phases in production-like environment.
- **Phase Exit Criteria:** `docker compose up` with a config file, send requests through the proxy, restart the container, verify state persists (rate limits, logs).

### Research Flags

**Phases that need `/gsd:research-phase` during planning:**
- **Phase 2 (SSE Streaming):** SSE handling nuances are complex. Research SSE parser libraries (eventsource-parser), Node.js streaming best practices, backpressure handling.
- **Phase 3 (Rate Limit Tracking):** Provider-specific rate limit header formats. Research current header formats for OpenRouter, Groq, Cerebras (training data is May 2025, these may have changed).

**Phases with well-documented patterns (skip research):**
- **Phase 1 (Core Proxy):** Standard HTTP middleware patterns, adapter pattern, chain of responsibility.
- **Phase 4 (Persistence):** SQLite + Drizzle is well-documented.
- **Phase 5 (Web UI):** React + TanStack Query + Vite is standard SPA stack.
- **Phase 6 (Deployment):** Docker multi-stage builds are standard.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Hono, SQLite, React+Vite are mature, well-understood choices. Version numbers MEDIUM (based on May 2025 training, verify before install). |
| Features | HIGH | Table stakes and differentiators drawn from analysis of LiteLLM, OpenRouter, Portkey. Anti-features validated against real product complexity. |
| Architecture | HIGH | Layered gateway pattern is standard. Provider adapter layer, rate limit state machine, SSE passthrough are proven patterns. |
| Pitfalls | HIGH | Drawn from LiteLLM GitHub issues, Portkey architecture docs, Node.js streaming gotchas, real-world proxy deployment experience. |

**Overall Confidence:** MEDIUM-HIGH. The architectural approach and feature set are high-confidence because the patterns are well-established. Exact version numbers and current provider API details are medium-confidence because they're based on May 2025 training data. WebSearch/WebFetch were unavailable during research — verify these before implementation:
- Current npm package versions (Hono, better-sqlite3, Drizzle, React, Vite, Tailwind)
- Current provider rate limit header formats (OpenRouter, Groq, Cerebras)
- Current provider API quirks (supported parameters, error shapes, SSE formats)
- Current `eventsource-parser` library API

### Gaps to Address

1. **Provider API verification:** Training data on Groq, Cerebras, OpenRouter APIs is May 2025. Rate limit headers, supported parameters, and model availability may have changed. Validate during Phase 1 implementation.

2. **SSE library selection:** `eventsource-parser` was recommended based on training knowledge. Verify it still exists and is maintained. Check for alternatives (native Node.js SSE handling, Hono SSE helpers).

3. **Docker base image security:** Node 20-slim recommended. Verify current security status, check for newer LTS versions (Node 22 is current LTS as of training cutoff).

4. **Tailwind v4 compatibility:** Training data indicates Tailwind v4 changed config format. Verify shadcn/ui compatibility with Tailwind v4. If issues, use Tailwind v3.

5. **React 19 breaking changes:** React 19 may have incompatibilities with some libraries. Verify TanStack Query, Recharts compatibility. If issues, use React 18.

## Sources

**Stack Research:**
- Hono documentation (framework features, streaming, Node.js adapter)
- better-sqlite3 documentation (API, WAL mode, performance)
- Drizzle ORM documentation (SQLite adapter, schema definition)
- Vite documentation (build tool, React plugin)
- TanStack Query documentation (server state management)
- OpenAI API reference (endpoint shapes, SSE format)
- Zod, Pino, shadcn/ui documentation

**Feature Research:**
- LiteLLM documentation and GitHub repository (as of early 2025)
- OpenRouter API documentation (as of early 2025)
- Portkey AI gateway documentation (as of early 2025)
- Helicone observability platform (as of early 2025)
- Cloudflare AI Gateway (as of early 2025)

**Architecture Research:**
- LiteLLM proxy architecture (Python-based AI gateway)
- Portkey AI Gateway architecture (TypeScript-based gateway)
- OpenAI API specification (endpoint shapes, SSE format, response structures)
- API gateway design patterns (circuit breaker, token bucket, sliding window)
- Node.js streaming best practices (Transform streams, backpressure handling)

**Pitfall Research:**
- LiteLLM GitHub issues (SSE streaming, provider integration, rate limiting)
- Portkey architecture documentation (proxy patterns, adapter layer)
- OpenAI API specification (SDK expectations)
- Node.js streaming gotchas (buffering, backpressure, AbortController)
- Provider-specific API behaviors (OpenRouter, Groq, Cerebras)

**Source Confidence Note:** All sources are from training data (cutoff May 2025). WebSearch and WebFetch were unavailable during research. Version numbers and provider-specific details should be verified before implementation. Architectural recommendations and patterns are HIGH confidence — these are well-established tools unlikely to have been superseded in the ~9 months since training cutoff.

---
*Research completed: 2026-02-05*
*Ready for roadmap: yes*
