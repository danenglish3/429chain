# Roadmap: 429chain

## Overview

429chain delivers an OpenAI-compatible proxy that maximizes free AI inference by waterfalling requests through configurable provider chains. The roadmap builds from a working non-streaming proxy with waterfall routing (Phase 1) through SSE streaming (Phase 2), intelligent rate limit tracking (Phase 3), observability (Phase 4), a management Web UI (Phase 5), and production-ready Docker deployment (Phase 6). Each phase delivers a coherent, verifiable capability that builds on the previous.

## Phases

- [ ] **Phase 1: Core Waterfall Proxy** - Non-streaming OpenAI-compatible proxy with waterfall routing on 429
- [ ] **Phase 2: SSE Streaming** - Real-time streaming support for chat completions
- [ ] **Phase 3: Rate Limit Intelligence** - Proactive header tracking and intelligent provider skipping
- [ ] **Phase 4: Observability & Persistence** - Request logging, usage tracking, and stats aggregation
- [ ] **Phase 5: Web UI** - Browser-based dashboard for provider/chain management and monitoring
- [ ] **Phase 6: Docker Deployment** - Production-ready containerized deployment

## Phase Details

### Phase 1: Core Waterfall Proxy
**Goal**: Users can send OpenAI-compatible chat requests that automatically waterfall through provider chains when rate limits are hit
**Depends on**: Nothing (first phase)
**Requirements**: PRXY-01, PRXY-03, PRXY-04, PRXY-05, PRXY-06, CHAN-01, CHAN-02, CHAN-03, RATE-01, RATE-02, DEPL-01, DEPL-03
**Success Criteria** (what must be TRUE):
  1. A developer can point an OpenAI SDK at the proxy and get a non-streaming chat completion response without changing any client code
  2. When the first provider in a chain returns 429, the proxy automatically tries the next provider and returns a successful response to the caller
  3. A provider that returned 429 is put on cooldown and automatically re-enabled when the cooldown expires
  4. The proxy rejects requests that do not include a valid API key
  5. When all providers in a chain are exhausted, the caller receives a detailed error listing each provider and its failure reason
**Plans**: 4

Plans:
- [ ] 01-01-PLAN.md -- Project scaffolding, config schema, and foundation types (Wave 1)
- [ ] 01-02-PLAN.md -- Provider adapter layer and chain configuration (Wave 2)
- [ ] 01-03-PLAN.md -- Waterfall chain router with reactive 429 handling and cooldown (Wave 2)
- [ ] 01-04-PLAN.md -- OpenAI-compatible HTTP endpoints and auth middleware (Wave 3)

### Phase 2: SSE Streaming
**Goal**: Users receive real-time token-by-token streaming responses through the proxy
**Depends on**: Phase 1
**Requirements**: PRXY-02
**Success Criteria** (what must be TRUE):
  1. A developer can send `stream: true` requests and receive real-time SSE chunks with no perceptible buffering delay
  2. Waterfall routing works before streaming begins -- if the first provider is exhausted, the proxy skips to an available provider before starting the stream
  3. When a client disconnects mid-stream, the proxy cleans up the upstream provider connection (no leaked connections or memory)
**Plans**: 3

Plans:
- [ ] 02-01: SSE stream parsing, bridging, and response piping
- [ ] 02-02: Pre-stream waterfall validation and mid-stream error handling
- [ ] 02-03: AbortController wiring and client disconnect cleanup

### Phase 3: Rate Limit Intelligence
**Goal**: The proxy proactively avoids exhausted providers by tracking rate limit headers, eliminating wasted 429 requests
**Depends on**: Phase 2
**Requirements**: RATE-03, RATE-04, RATE-05
**Success Criteria** (what must be TRUE):
  1. After receiving a response with rate limit headers (x-ratelimit-remaining, x-ratelimit-reset), the proxy tracks remaining quota and skips the provider before it returns 429
  2. Users can manually configure rate limits per provider (RPM, daily token limits, concurrent request limits) as a fallback when headers are unavailable
  3. An exhausted provider is automatically skipped in the chain without making a request, and the next available provider is used instead
**Plans**: 3

Plans:
- [ ] 03-01: Rate limit header parser and state machine (AVAILABLE/TRACKING/EXHAUSTED)
- [ ] 03-02: Proactive provider skipping in chain router
- [ ] 03-03: Manual rate limit configuration and fallback logic

### Phase 4: Observability & Persistence
**Goal**: Users can see what the proxy is doing -- which providers are being used, how many tokens are consumed, and current rate limit status
**Depends on**: Phase 3
**Requirements**: OBSV-01, OBSV-02, OBSV-03, OBSV-04
**Success Criteria** (what must be TRUE):
  1. Every request is logged with the provider used, model, tokens consumed (prompt + completion), latency, and HTTP status
  2. Users can query aggregate usage totals per provider (total tokens, total requests) and per chain
  3. Users can see live rate limit status for each provider -- remaining requests per minute, daily tokens left, and active cooldown timers
**Plans**: 3

Plans:
- [ ] 04-01: SQLite persistence layer and request logging
- [ ] 04-02: Usage aggregation engine (per-provider and per-chain totals)
- [ ] 04-03: Live rate limit status API and stats endpoints

### Phase 5: Web UI
**Goal**: Users can manage providers, chains, and monitor usage through a browser-based dashboard without editing config files
**Depends on**: Phase 4
**Requirements**: WEBU-01, WEBU-02, WEBU-03, WEBU-04
**Success Criteria** (what must be TRUE):
  1. A user can add a new provider with its API key through the UI and see which models are available from that provider
  2. A user can create and edit chains by adding, removing, and reordering provider+model pairs through the UI
  3. A user can view a usage dashboard showing per-provider totals, per-chain totals, a scrollable request log, and live rate limit status
  4. A user can send a test prompt from the UI and see which provider served it, the response content, and the latency
**Plans**: 4

Plans:
- [ ] 05-01: Admin API endpoints (CRUD for providers, chains, stats)
- [ ] 05-02: React SPA scaffolding and provider management page
- [ ] 05-03: Chain editor with drag-to-reorder and usage dashboard
- [ ] 05-04: Test endpoint page and live rate limit status display

### Phase 6: Docker Deployment
**Goal**: Users can deploy the complete proxy with one command using Docker
**Depends on**: Phase 5
**Requirements**: DEPL-02
**Success Criteria** (what must be TRUE):
  1. A user can run `docker compose up` with a config file and have the proxy, Web UI, and persistence all running
  2. After restarting the container, all configuration, logs, and usage data persist through volume mounts
  3. Docker health checks use the `/health` endpoint to report container status
**Plans**: 3

Plans:
- [ ] 06-01: Multi-stage Dockerfile and docker-compose configuration
- [ ] 06-02: Volume mounts, environment variable handling, and health check integration
- [ ] 06-03: End-to-end deployment validation and config examples

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|---------------|--------|-----------|
| 1. Core Waterfall Proxy | 0/4 | Planned | - |
| 2. SSE Streaming | 0/3 | Not started | - |
| 3. Rate Limit Intelligence | 0/3 | Not started | - |
| 4. Observability & Persistence | 0/3 | Not started | - |
| 5. Web UI | 0/4 | Not started | - |
| 6. Docker Deployment | 0/3 | Not started | - |

---
*Roadmap created: 2026-02-05*
*Last updated: 2026-02-05 after Phase 1 planning*
