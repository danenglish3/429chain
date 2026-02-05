---
phase: 01-core-waterfall-proxy
plan: 03
subsystem: ratelimit, chain-routing
tags: [typescript, ratelimit, cooldown, waterfall, chain-router, setTimeout]
dependency-graph:
  requires:
    - phase: 01-01
      provides: error classes (ProviderError, ProviderRateLimitError, AllProvidersExhaustedError), shared types (AttemptRecord, ChatCompletionRequest/Response), provider types (ProviderAdapter, ProviderResponse, RateLimitInfo), logger
  provides:
    - RateLimitTracker with per-provider+model exhausted/available state
    - CooldownManager with auto-recovery timers
    - Chain/ChainEntry/ChainResult types
    - executeChain waterfall router
    - resolveChain chain name resolution
    - ProviderRegistry interface
    - buildChains factory function
  affects: [01-04, 02-02, 03-01, 03-02]
tech-stack:
  added: []
  patterns: [composite-key-state-tracking, timer-based-auto-recovery, waterfall-execution, race-condition-safety-check]
key-files:
  created:
    - src/ratelimit/types.ts
    - src/ratelimit/cooldown.ts
    - src/ratelimit/tracker.ts
    - src/ratelimit/__tests__/tracker.test.ts
    - src/chain/types.ts
    - src/chain/router.ts
    - src/chain/__tests__/router.test.ts
  modified:
    - src/providers/types.ts
key-decisions:
  - "Composite key ${providerId}:${model} for rate limit tracking since limits are per provider+model"
  - "Timer.unref() on cooldown timers to prevent keeping process alive during shutdown"
  - "Race condition safety: isExhausted double-checks cooldownUntil timestamp in case timer hasn't fired yet"
  - "ProviderRegistry interface added to providers/types.ts to unblock chain router before plan 01-02"
patterns-established:
  - "Composite key pattern: ${providerId}:${model} for per-provider+model state"
  - "Waterfall pattern: iterate entries, skip exhausted, try each, continue on any failure"
  - "Proactive exhaustion: mark provider exhausted when remaining requests = 0 even on success"
metrics:
  duration: ~6min
  completed: 2026-02-05
---

# Phase 01 Plan 03: Waterfall Chain Router with Reactive 429 Handling and Cooldown Summary

**Per-provider+model rate limit tracker with cooldown timers and waterfall chain router that skips exhausted providers, handles 429/5xx/network errors, and throws AllProvidersExhaustedError with detailed attempt records**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-02-05T04:41:25Z
- **Completed:** 2026-02-05T04:47:02Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Rate limit tracker manages per-provider+model exhausted/available state with automatic cooldown recovery
- Chain router waterfalls through entries in order, skipping exhausted providers without making requests
- All provider failures (429, 5xx, timeout, connection refused) trigger waterfall to next entry
- AllProvidersExhaustedError includes complete attempt history for debugging
- Proactive exhaustion: providers are marked exhausted when their remaining request count hits zero
- 30 new tests (14 tracker + 16 router) covering all state transitions and waterfall scenarios

## Task Commits

Each task was committed atomically:

1. **Task 1: Rate limit tracker and cooldown manager** - `32faca9` (feat)
2. **Task 2: Chain types and waterfall router** - `631bde2` (feat)

## Files Created/Modified
- `src/ratelimit/types.ts` - RateLimitState type, CooldownEntry and TrackerEntry interfaces
- `src/ratelimit/cooldown.ts` - CooldownManager class: schedule/cancel/cancelAll timer management
- `src/ratelimit/tracker.ts` - RateLimitTracker class: isExhausted/markExhausted/markAvailable/getStatus/getAllStatuses/shutdown
- `src/ratelimit/__tests__/tracker.test.ts` - 14 tests for tracker and cooldown manager
- `src/chain/types.ts` - Chain, ChainEntry, ChainResult interfaces and buildChains factory
- `src/chain/router.ts` - executeChain waterfall function and resolveChain helper
- `src/chain/__tests__/router.test.ts` - 16 tests with mocked adapters for all waterfall scenarios
- `src/providers/types.ts` - Added ProviderRegistry interface (get/has/getAll methods)

## Decisions Made

1. **Composite key `${providerId}:${model}`**: Rate limits are per provider+model, not just per provider. A provider may have different rate limits for different models.

2. **Timer.unref()**: Cooldown timers are unref'd so they don't keep the Node.js process alive during graceful shutdown. The shutdown() method also cancels all timers explicitly.

3. **Race condition safety in isExhausted**: If the cooldown timestamp has expired but the setTimeout hasn't fired yet, isExhausted detects this and marks the provider available immediately. Prevents unnecessarily skipping a provider.

4. **ProviderRegistry interface added to providers/types.ts**: The chain router needs to look up adapters by ID. Since plan 01-02 (provider adapter layer) is a parallel wave, I added the ProviderRegistry interface to the existing types file so the router compiles. The concrete implementation will be built in 01-02.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added ProviderRegistry interface to providers/types.ts**
- **Found during:** Task 2 (Chain types and waterfall router)
- **Issue:** The chain router calls `registry.get(entry.providerId)` but no ProviderRegistry type existed. Plan 01-02 (which creates the concrete registry) is in the same wave and hasn't been executed.
- **Fix:** Added a `ProviderRegistry` interface with `get()`, `has()`, and `getAll()` methods to `src/providers/types.ts`.
- **Files modified:** src/providers/types.ts
- **Verification:** `npx tsc --noEmit` passes, all tests pass
- **Committed in:** 631bde2 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Interface-only addition required for compilation. No scope creep. The concrete ProviderRegistry implementation remains in plan 01-02.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness

Plan 01-02 (provider adapter layer) can implement the concrete ProviderRegistry class against the interface defined here. Plan 01-04 (HTTP endpoints) can wire up the chain router with:
- `executeChain()` for handling incoming chat completion requests
- `resolveChain()` for determining which chain to use
- `RateLimitTracker` instantiated from config.settings.cooldownDefaultMs
- `buildChains()` to create runtime Chain objects from config

All prerequisites for plan 01-04 are now available from this plan and plan 01-01.

---
*Phase: 01-core-waterfall-proxy*
*Completed: 2026-02-05*
