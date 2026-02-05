# Requirements: 429chain

**Defined:** 2026-02-05
**Core Value:** Requests never fail due to rate limits when free tokens exist somewhere in the chain

## v1 Requirements

### Proxy Core

- [ ] **PRXY-01**: OpenAI-compatible `/v1/chat/completions` endpoint accepts standard OpenAI request format (temperature, max_tokens, top_p, stop, tools/functions, response_format)
- [ ] **PRXY-02**: Streaming (SSE) responses with proper `text/event-stream` headers, `no-cache`, and real-time chunk delivery (no buffering)
- [ ] **PRXY-03**: Non-streaming responses for `stream: false` requests
- [ ] **PRXY-04**: `/v1/models` endpoint returns available models from configured providers
- [ ] **PRXY-05**: `/health` endpoint returns proxy status for monitoring/Docker health checks
- [ ] **PRXY-06**: Detailed error messages when all chain entries fail (e.g., "Tried 3 providers: Groq (429), OpenRouter (timeout), Cerebras (auth error)")

### Chain Engine

- [ ] **CHAN-01**: Configurable chains as ordered lists of provider+model pairs
- [ ] **CHAN-02**: Waterfall routing -- on 429 or provider failure, automatically try next entry in chain
- [ ] **CHAN-03**: Multiple named chains for different use cases (e.g., "coding", "chat", "fast")

### Rate Limit Intelligence

- [ ] **RATE-01**: Reactive 429 detection -- detect rate limit responses and put provider+model on cooldown
- [ ] **RATE-02**: Auto-recovery -- re-enable providers when cooldown timer expires based on reset time
- [ ] **RATE-03**: Proactive rate limit tracking -- extract x-ratelimit-remaining/reset/limit from provider response headers
- [ ] **RATE-04**: Provider skipping -- skip providers known to be exhausted without making a request, jump to next in chain
- [ ] **RATE-05**: Manual rate limit configuration per provider as fallback (RPM, daily token limits, concurrent request limits)

### Observability

- [ ] **OBSV-01**: Request logging -- provider used, model, tokens consumed (prompt + completion), latency, HTTP status per request
- [ ] **OBSV-02**: Per-provider usage totals -- aggregate token counts and request counts per provider
- [ ] **OBSV-03**: Per-chain usage totals -- aggregate token counts and request counts per chain
- [ ] **OBSV-04**: Live rate limit status -- remaining quota per provider (requests per minute left, daily tokens left, active cooldown timers)

### Web UI

- [ ] **WEBU-01**: Provider management -- add/remove providers with API keys, view available models per provider
- [ ] **WEBU-02**: Chain management -- create/edit/reorder provider+model pairs within chains
- [ ] **WEBU-03**: Usage dashboard -- per-provider totals, per-chain totals, scrollable request log, live rate limit status display
- [ ] **WEBU-04**: Test endpoint -- send a prompt from the UI, see which provider served it, response content, and latency

### Deployment & Config

- [ ] **DEPL-01**: YAML config file for providers, chains, rate limits, and proxy settings with Zod schema validation
- [ ] **DEPL-02**: Docker deployment via docker-compose with config and data volume mounts
- [ ] **DEPL-03**: API key gated access -- proxy rejects requests without valid API key

## v2 Requirements

### Deployment

- **DEPL-04**: npm/CLI package -- install globally and run via `npx 429chain`

### Proxy Enhancements

- **PRXY-07**: Pre-stream provider validation -- check provider availability before starting SSE stream
- **PRXY-08**: Config hot-reload -- update config without restarting the proxy

### Observability Enhancements

- **OBSV-05**: Provider health monitoring -- track error rates and latency trends per provider
- **OBSV-06**: "Money saved" metric -- calculate hypothetical cost of free-tier usage

### Additional Endpoints

- **PRXY-09**: Embeddings endpoint (`/v1/embeddings`) for embedding model support

### Performance

- **RATE-06**: Latency-aware routing mode -- prefer fastest provider with available quota
- **PRXY-10**: Exact-match response caching for identical repeated requests

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cost-optimized routing | Irrelevant for free tiers -- all providers cost $0 |
| Semantic caching | Low hit rates for real workloads, stale response risk, adds significant complexity |
| Multi-user accounts / RBAC | Massive scope creep -- API key gating is sufficient |
| Prompt transformation / middleware | Prompt injection risks, debugging nightmare, proxy should pass through unmodified |
| Content filtering / guardrails | Rely on provider-side filtering, avoid false positives and legal complexity |
| Image / audio endpoints | Scope explosion -- each modality has different streaming, rate limits, and provider support |
| Provider auto-discovery | Security risk (unknown endpoints), reliability risk (untested providers) |
| Plugin / extension system | Premature abstraction -- build good core first |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PRXY-01 | Phase 1 | Pending |
| PRXY-02 | Phase 2 | Pending |
| PRXY-03 | Phase 1 | Pending |
| PRXY-04 | Phase 1 | Pending |
| PRXY-05 | Phase 1 | Pending |
| PRXY-06 | Phase 1 | Pending |
| CHAN-01 | Phase 1 | Pending |
| CHAN-02 | Phase 1 | Pending |
| CHAN-03 | Phase 1 | Pending |
| RATE-01 | Phase 1 | Pending |
| RATE-02 | Phase 1 | Pending |
| RATE-03 | Phase 3 | Pending |
| RATE-04 | Phase 3 | Pending |
| RATE-05 | Phase 3 | Pending |
| OBSV-01 | Phase 4 | Pending |
| OBSV-02 | Phase 4 | Pending |
| OBSV-03 | Phase 4 | Pending |
| OBSV-04 | Phase 4 | Pending |
| WEBU-01 | Phase 5 | Pending |
| WEBU-02 | Phase 5 | Pending |
| WEBU-03 | Phase 5 | Pending |
| WEBU-04 | Phase 5 | Pending |
| DEPL-01 | Phase 1 | Pending |
| DEPL-02 | Phase 6 | Pending |
| DEPL-03 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 25 total
- Mapped to phases: 25
- Unmapped: 0

---
*Requirements defined: 2026-02-05*
*Last updated: 2026-02-05 after roadmap creation*
