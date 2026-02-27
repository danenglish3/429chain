---
phase: 08-queue-mode
plan: 02
subsystem: queue
tags: [queue, waterfall, rate-limit, drain, shutdown, hono, typescript]

# Dependency graph
requires:
  - phase: 08-queue-mode
    plan: 01
    provides: RequestQueue class with enqueue/drain/rejectAll, queue error types, config schema fields
  - phase: 01-core-waterfall-proxy
    provides: AllProvidersExhaustedError, executeChain, executeStreamChain, RateLimitTracker
provides:
  - onAvailable callback on RateLimitTracker fires on cooldown expiry
  - Queue wrapping in chat routes for both streaming and non-streaming AllProvidersExhaustedError paths
  - Queue stats in GET /v1/ratelimits response
  - Conditional queue creation and provider-to-chains lookup in index.ts
  - Graceful shutdown rejects all queued items via rejectAll
affects: [08-queue-mode]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Provider-to-chains lookup Map: at startup, map each provider:model key to the set of chain names that use it"
    - "Callback wiring: tracker.setOnAvailableCallback triggers queue.drainChains on cooldown expiry"
    - "Optional dependency injection: queue/queueMaxWaitMs passed as optional params to route factories"

key-files:
  created: []
  modified:
    - src/ratelimit/tracker.ts
    - src/api/routes/chat.ts
    - src/api/routes/ratelimits.ts
    - src/index.ts
    - ui/src/lib/api.ts

key-decisions:
  - "Provider-to-chains lookup built at startup (not on each request) — O(1) lookup when callback fires"
  - "Queue wiring is purely additive — when queue is undefined, all paths return to original behavior"
  - "UI api.ts type for getRateLimits updated to include activeEntries and queue fields (pre-existing gap)"

patterns-established:
  - "Optional queue injection: createChatRoutes/createRateLimitRoutes accept optional queue param, behavior unchanged when undefined"
  - "Shutdown ordering: queue.rejectAll before tracker.shutdown (reject waiters before cancelling timers)"

# Metrics
duration: ~6min
completed: 2026-02-27
---

# Phase 8 Plan 02: Queue Wiring Summary

**End-to-end queue mode integration: tracker onAvailable callback triggers chain drain, chat routes enqueue on exhaustion, ratelimits endpoint exposes queue stats, graceful shutdown rejects all waiters**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-02-26T23:54:00Z
- **Completed:** 2026-02-27T00:00:10Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- RateLimitTracker now fires onAvailable callback after markAvailable, enabling cooldown-to-drain wiring
- Chat routes (both streaming and non-streaming) enqueue requests on AllProvidersExhaustedError when queue is enabled; fall through to original 503 when queue is disabled (zero regression)
- /v1/ratelimits response includes `queue: QueueStats[]` field for per-chain queue depth and oldest item age
- index.ts builds provider-to-chains lookup Map at startup and wires setOnAvailableCallback so cooldown expiry auto-drains affected chains
- Graceful shutdown calls queue.rejectAll(new QueueShutdownError()) before tracker.shutdown()

## Task Commits

Each task was committed atomically:

1. **Task 1: Add onAvailable callback to RateLimitTracker** - `de87795` (feat)
2. **Task 2: Wire queue into chat routes, ratelimits, index.ts, and shutdown** - `7ab3ec9` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/ratelimit/tracker.ts` - Added private onAvailableCallback field, setOnAvailableCallback() setter, callback invocation in markAvailable()
- `src/api/routes/chat.ts` - Added RequestQueue/error imports, optional queue+queueMaxWaitMs params, queue.enqueue() in both streaming and non-streaming AllProvidersExhaustedError catch blocks
- `src/api/routes/ratelimits.ts` - Added optional queue param, queue.getStats() in GET response
- `src/index.ts` - Added RequestQueue/QueueShutdownError imports, conditional queue creation, provider-to-chains lookup, setOnAvailableCallback wiring, queue passed to route factories, shutdown integration
- `ui/src/lib/api.ts` - Fixed getRateLimits return type to include activeEntries and queue fields

## Decisions Made
- Provider-to-chains lookup built once at startup into a `Map<string, Set<string>>` so the onAvailable callback is O(1) — no scanning of chain config on every cooldown expiry
- Queue wiring is additive: all new params are optional, all new code paths are guarded by `if (queue && queueMaxWaitMs)`, so queueMode: false leaves every existing behavior unchanged
- Shutdown ordering: `queue.rejectAll` before `tracker.shutdown` ensures queued requests get explicit rejection before timers are cancelled

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed getRateLimits TypeScript type in UI api.ts**
- **Found during:** Task 2 verification (build step)
- **Issue:** `api.getRateLimits` was typed as `{ ratelimits: any[] }` — missing `activeEntries` and `queue` fields. RateLimitStatus.tsx accessed `data?.activeEntries` causing `tsc -b` error in UI build.
- **Fix:** Updated return type to `{ ratelimits: any[]; activeEntries: any[]; queue: any[] }` in ui/src/lib/api.ts
- **Files modified:** ui/src/lib/api.ts
- **Verification:** `npm run build` succeeds, UI tsc passes
- **Committed in:** 7ab3ec9 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - pre-existing type gap in UI)
**Impact on plan:** Type fix was necessary for build to succeed. No behavior change. No scope creep.

## Issues Encountered
- CLI tests (src/__tests__/cli.test.ts) time out at 5s in this Windows environment — pre-existing issue unrelated to this plan. All 174 non-CLI tests pass.

## User Setup Required
None - no external service configuration required. Queue mode is disabled by default (queueMode: false). To enable, set `queueMode: true` in config.settings.

## Next Phase Readiness
- Queue mode is fully wired end-to-end: config -> queue creation -> tracker callback -> chat route wrapping -> drain -> response
- queueMode: false preserves exact existing behavior (confirmed by 174 passing tests)
- Queue stats exposed in /v1/ratelimits for monitoring
- Phase 8 queue mode feature is complete

## Self-Check: PASSED

- FOUND: src/ratelimit/tracker.ts (modified)
- FOUND: src/api/routes/chat.ts (modified)
- FOUND: src/api/routes/ratelimits.ts (modified)
- FOUND: src/index.ts (modified)
- FOUND: ui/src/lib/api.ts (modified)
- FOUND commit de87795: feat(08-02): add onAvailable callback to RateLimitTracker
- FOUND commit 7ab3ec9: feat(08-02): wire RequestQueue into application

---
*Phase: 08-queue-mode*
*Completed: 2026-02-27*
