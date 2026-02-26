---
phase: 08-queue-mode
plan: 01
subsystem: queue
tags: [vitest, fake-timers, deferred-promise, fifo, tdd]

# Dependency graph
requires:
  - phase: 01-core-waterfall-proxy
    provides: AllProvidersExhaustedError used in drainOne stop condition
  - phase: 07-cli-support
    provides: completed codebase baseline
provides:
  - RequestQueue class with enqueue, drainOne, drainChains, getStats, rejectAll
  - QueueTimeoutError, QueueFullError, QueueShutdownError error classes
  - queueMode, queueMaxWaitMs, queueMaxSize in SettingsSchema
affects: [08-queue-mode]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Deferred-Promise pattern: resolve/reject callbacks stored on QueueItem with settled flag for race safety"
    - "queueMicrotask for non-recursive chained draining (avoids stack overflow on long queues)"
    - "Timeout unref() pattern to prevent keeping process alive during shutdown"

key-files:
  created:
    - src/queue/types.ts
    - src/queue/request-queue.ts
    - src/queue/__tests__/request-queue.test.ts
  modified:
    - src/shared/errors.ts
    - src/config/schema.ts

key-decisions:
  - "Settled flag on QueueItem prevents double-resolve/reject races between timeout and drain"
  - "AllProvidersExhaustedError stops drain (chain still exhausted), other errors reject and continue"
  - "queueMicrotask for continuation drain avoids synchronous recursion while staying non-blocking"
  - "removeItem on timeout keeps queue consistent (settled item removed so drain skips it cleanly)"
  - "Per-chain queue map allows independent depth/timeout tracking per chain name"
  - "queueMaxWaitMs default 300_000ms (5 minutes) for long-running requests"

patterns-established:
  - "Deferred-Promise Queue: resolve/reject stored on item object, settled flag gates all settlements"
  - "Drain-stop semantics: AllProvidersExhaustedError = stop (retry later), other = fail item and continue"

# Metrics
duration: 5min
completed: 2026-02-27
---

# Phase 8 Plan 01: RequestQueue Core Summary

**FIFO deferred-Promise queue per chain with settled-flag safety, timeout, max-size, AllProvidersExhaustedError stop semantics, and 12 passing vitest unit tests**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-02-26T23:45:35Z
- **Completed:** 2026-02-26T23:50:54Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- QueueItem and QueueStats type interfaces with settled flag for race-condition safety
- QueueTimeoutError, QueueFullError, QueueShutdownError error classes with toOpenAIError() methods
- SettingsSchema extended with queueMode (bool), queueMaxWaitMs (5min default), queueMaxSize (100 default)
- RequestQueue class with FIFO enqueue/drain, AllProvidersExhaustedError stop semantics, microtask-based continuation, graceful shutdown via rejectAll
- 12 unit tests covering all behaviors with vi.useFakeTimers() for timeout control

## Task Commits

Each task was committed atomically:

1. **Task 1: Queue types, error classes, and config schema** - `35a97d4` (feat)
2. **Task 2 RED: Failing tests for RequestQueue** - `53c30ff` (test)
3. **Task 2 GREEN: Implement RequestQueue class** - `5207ea0` (feat)

**Plan metadata:** (docs commit follows)

_Note: TDD tasks have multiple commits (test RED -> feat GREEN)_

## Files Created/Modified
- `src/queue/types.ts` - QueueItem and QueueStats interface definitions
- `src/queue/request-queue.ts` - RequestQueue class implementation
- `src/queue/__tests__/request-queue.test.ts` - 12 unit tests using vi.useFakeTimers()
- `src/shared/errors.ts` - Added QueueTimeoutError, QueueFullError, QueueShutdownError
- `src/config/schema.ts` - Added queueMode, queueMaxWaitMs, queueMaxSize to SettingsSchema

## Decisions Made
- Settled flag on QueueItem prevents double-resolve/reject races between timeout handler and drain
- AllProvidersExhaustedError stops drain (chain still rate-limited, item stays queued for retry); any other error rejects the item and continues to next
- queueMicrotask for continuation drain after success/non-exhaustion-failure: avoids synchronous recursion, stays in microtask queue (before I/O, no fake-timer interference)
- removeItem called by timeout handler ensures timed-out items are removed from queue so drainOne skips them cleanly
- Per-chain queue Map allows independent tracking (different chains can have different depths/timeouts)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test assertions for FIFO and continuation drain**
- **Found during:** Task 2 GREEN phase (test run)
- **Issue:** FIFO test checked `executeB not called` after `await drainOne` — but `queueMicrotask` fires within the same await, calling B. Continuation drain test used `setImmediate` which doesn't work with fake timers.
- **Fix:** FIFO test uses deferred Promise to pause executeA mid-execution so B is provably not-yet-called. Continuation drain test uses `await Promise.resolve()` twice to flush microtask queue instead of `setImmediate`.
- **Files modified:** src/queue/__tests__/request-queue.test.ts
- **Verification:** All 12 tests pass
- **Committed in:** 5207ea0 (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug in test assertions)
**Impact on plan:** Test assertions adjusted to match correct implementation semantics. No behavior change to the implementation.

## Issues Encountered
- `queueMicrotask` continuation drain fires synchronously within `await drainOne()` in tests — required deferred-Promise pattern in FIFO test and double `await Promise.resolve()` in continuation test to observe intermediate state correctly.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- RequestQueue core is complete and tested, ready for wiring into the application
- Next: integrate RequestQueue into the chain executor and HTTP handlers (plan 08-02)
- Queue drain trigger needs wiring to cooldown timer callbacks

## Self-Check: PASSED

- FOUND: src/queue/types.ts
- FOUND: src/queue/request-queue.ts
- FOUND: src/queue/__tests__/request-queue.test.ts
- FOUND: .planning/phases/08-queue-mode/08-01-SUMMARY.md
- FOUND commit 35a97d4: feat(08-01): add queue types, error classes, and config schema fields
- FOUND commit 53c30ff: test(08-01): add failing tests for RequestQueue
- FOUND commit 5207ea0: feat(08-01): implement RequestQueue class

---
*Phase: 08-queue-mode*
*Completed: 2026-02-27*
