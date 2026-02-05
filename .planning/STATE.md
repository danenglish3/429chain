# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-05)

**Core value:** Requests never fail due to rate limits when free tokens exist somewhere in the chain
**Current focus:** Phase 5 - Web UI (in progress)

## Current Position

Phase: 5 of 6 (Web UI)
Plan: 1 of 3 in current phase -- COMPLETE
Status: In progress
Last activity: 2026-02-06 -- Completed 05-01-PLAN.md

Progress: [###############.....] 74%

## Performance Metrics

**Velocity:**
- Total plans completed: 14
- Average duration: ~4.6 minutes
- Total execution time: ~69 minutes

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 - Core Waterfall Proxy | 4/4 | ~25min | ~6.25min |
| 2 - SSE Streaming | 2/2 | ~6min | ~3min |
| 3 - Rate Limit Intelligence | 4/4 | ~14min | ~3.5min |
| 4 - Observability & Persistence | 3/3 | ~17min | ~5.7min |
| 5 - Web UI | 1/3 | ~8min | ~8min |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [d001] Use Zod v4 with z.prettifyError() for config validation errors
- [d002] ESM-only project with NodeNext module resolution
- [d003] Pino logger with path-based redaction configured at import time
- [d004] Composite key ${providerId}:${model} for per-provider+model rate limit tracking
- [d005] Timer.unref() on cooldown timers to prevent keeping process alive during shutdown
- [d006] Race condition safety: isExhausted double-checks cooldownUntil timestamp
- [d007] Route factory pattern: route creators take dependencies and return Hono sub-apps
- [d008] Selective auth via Hono sub-app mounting: /health public, /v1/* protected
- [d009] Model field as chain name hint: model field selects chain if name matches
- [d010] chatCompletionStream returns raw Response (not ProviderResponse) for unconsumed ReadableStream
- [d011] SSE parser factory pattern with stateful buffer encapsulation
- [d012] prepareRequestBody called first, then stream:true override (preserves body prep logic)
- [d013] executeStreamChain happens OUTSIDE streamSSE() so all-exhausted returns JSON 503 error not empty stream
- [d014] Definite assignment assertion on streamResult (catch block always exits via return/throw)
- [d015] AbortError handled silently (debug log) vs real errors (error log + error event)
- [d016] Three-state rate limit model: 'tracking' state added between 'available' and 'exhausted'
- [d017] Proactive exhaustion when remainingRequests === 0 OR remainingTokens === 0
- [d018] Math.max of reset times when both request and token limits hit zero (longest wait wins)
- [d019] QuotaInfo includes lastUpdated timestamp for future staleness detection
- [d020] Streaming Response headers parsed before body consumption for quota tracking
- [d021] Both executeChain and executeStreamChain call tracker.updateQuota() after success
- [d022] Research Open Question #4 resolved: streaming responses parse headers proactively
- [d023] Manual rate limits optional per provider in config - existing configs without rateLimits still validate
- [d024] Manual limits only enforced when no headers present - header-based tracking takes precedence
- [d025] Window-based counter resets: track windowStart timestamp, reset when elapsed time exceeds window duration
- [d026] Manual limits registered only for provider+model pairs found in chains (not all possible combinations)
- [d027] Manual limit registration happens after tracker creation but before server starts
- [d028] Manual limit count logged at startup for configuration visibility
- [d029] SQLite with WAL mode for observability persistence (concurrent reads during writes, file-based deployment simplicity)
- [d030] Materialized aggregation tables with SQLite triggers (O(1) stats reads, no application-level aggregation)
- [d031] Fire-and-forget request logging with no error propagation (observability never fails proxy requests)
- [d032] Timestamp stored as INTEGER (Unix epoch ms for efficient sorting and time-range queries)
- [d033] setImmediate for fire-and-forget logging (schedules logging for next event loop tick, zero impact on response latency)
- [d034] stream_options.include_usage for streaming token capture (OpenAI-compatible providers send usage in final chunk)
- [d035] Try-catch around logRequest with error logging (observability never fails proxy requests)
- [d036] performance.now() for streaming latency measurement (monotonic high-resolution time, accurate for latency tracking)
- [d037] Admin routes use configRef wrapper ({ current: Config }) for mutable shared state
- [d038] writeConfig serializes to YAML with 2-space indent matching loader expectations
- [d039] DELETE /providers/:id validates no chains reference the provider before deletion
- [d040] DELETE /chains/:name prevents default chain deletion (referential integrity)
- [d041] PUT endpoints validate with Zod, return 400 with prettified errors on validation failure
- [d042] Provider apiKey masked as "***" in GET responses for security

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Session Continuity

Last session: 2026-02-06
Stopped at: Completed 05-01-PLAN.md (Admin CRUD API endpoints)
Resume file: None

Config:
{
  "mode": "yolo",
  "depth": "standard",
  "parallelization": true,
  "commit_docs": true,
  "workflow": {
    "research": true,
    "plan_check": true,
    "verifier": true
  }
}
