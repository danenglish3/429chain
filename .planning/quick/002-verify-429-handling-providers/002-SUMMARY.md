---
phase: quick
plan: 002
subsystem: chain-execution
tags: [rate-limiting, error-handling, retry-logic, provider-adapters]

requires: []
provides:
  - Float retry-after parsing (sub-second precision for Groq)
  - 402 Payment Required cooldown (5min for credit exhaustion)
affects: [all-providers]

tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - src/chain/router.ts
    - src/chain/__tests__/router.test.ts

decisions: []

metrics:
  duration: 3 minutes
  completed: 2026-02-08
---

# Quick Task 002: Verify 429 Handling Across Providers

**One-liner:** Fixed float retry-after parsing and added 402 Payment Required cooldown to prevent immediate retries

## Objective

Fix two rate-limit handling gaps discovered during provider testing:
1. Parse `retry-after` header with `parseFloat` instead of `parseInt` (Groq sends floats like "8.12")
2. Apply cooldown to OpenRouter 402 (Payment Required / credits exhausted) so the provider is skipped on subsequent requests

## Execution

### Task 1: Fix retry-after parsing and add 402 cooldown in router.ts

**Changes made:**

1. **Float retry-after parsing** (lines 102 and 259):
   - Changed `parseInt(retryAfterHeader, 10)` to `parseFloat(retryAfterHeader)`
   - Applied in both `executeChain` and `executeStreamChain`
   - Preserves sub-second precision (8.12s → 8120ms, not 8000ms)

2. **402 cooldown** (lines 137 and 298):
   - Added `if (error.statusCode === 402)` check in ProviderError catch block
   - Calls `tracker.markExhausted()` with 300,000ms (5 minutes) cooldown
   - Applied in both `executeChain` and `executeStreamChain`
   - Reason: `'402 payment required (credits exhausted)'`

**Rationale:**
- Groq's API returns fractional retry-after values (e.g., 8.12 seconds)
- OpenRouter returns 402 when credits are exhausted, but previous behavior had no cooldown
- Without cooldown, 402-returning providers are retried immediately on next request, wasting time

**Files modified:**
- `src/chain/router.ts`: 4 edits (2 parseFloat, 2 statusCode === 402 checks)

**Commit:** `b4221a6` - fix(quick-002): parseFloat for retry-after and 402 cooldown

**Verification:** All existing tests pass (29 tests in router.test.ts)

### Task 2: Add tests for float retry-after and 402 cooldown

**Tests added:**

1. **Float retry-after parsing** (1 test):
   - Verifies 8.12 seconds → 8120ms (not 8000ms from parseInt)
   - Uses `toBeCloseTo(8120, 0)` to handle floating-point precision

2. **402 cooldown in non-streaming** (1 test):
   - Verifies 402 triggers cooldown and waterfalls to next provider
   - Checks `tracker.isExhausted()` and `status.reason`

3. **402 cooldown in streaming** (1 test):
   - Same as above but for `executeStreamChain` path

4. **402-cooled provider skipped on next request** (1 test):
   - Verifies provider is skipped after 402 cooldown
   - Checks `chatCompletion` called only once (not retried)

**Files modified:**
- `src/chain/__tests__/router.test.ts`: 144 lines added (4 new tests in dedicated 402 describe block)

**Commit:** `74be681` - test(quick-002): add tests for float retry-after and 402 cooldown

**Verification:** All tests pass (33 tests in router.test.ts, 92 total across codebase)

## Verification Results

✅ All checks passed:
1. `npx vitest run` - 92 tests pass (33 in router.test.ts including 4 new tests)
2. `npx tsc --noEmit` - No type errors
3. `grep "parseInt.*retry-after" router.ts` - Zero matches (all replaced with parseFloat)
4. `grep "statusCode === 402" router.ts` - Two matches (executeChain + executeStreamChain)

## Deviations from Plan

None - plan executed exactly as written.

## Impact

**Providers affected:**
- **Groq:** Now respects sub-second retry-after values (common in their rate limiting)
- **OpenRouter:** 402 responses now trigger 5-minute cooldown (prevents immediate retry when credits exhausted)
- **All providers:** Any provider returning 402 will now be cooled down appropriately

**Behavior changes:**
- **Before:** `parseInt("8.12")` → 8000ms cooldown (loses 120ms precision)
- **After:** `parseFloat("8.12")` → 8120ms cooldown (exact precision)
- **Before:** 402 responses waterfall with no cooldown, retried immediately on next request
- **After:** 402 responses waterfall AND apply 5-minute cooldown, provider skipped until cooldown expires

## Testing

**Test coverage:**
- Float parsing: 1 test (8.12s → 8120ms)
- 402 cooldown: 3 tests (non-streaming, streaming, skip on next request)
- Total new tests: 4
- Total router tests: 33 (all passing)
- Total codebase tests: 92 (all passing)

**Manual verification:**
- TypeScript compilation: ✅ No errors
- Grep verification: ✅ All parseInt replaced, 402 checks in both paths

## Lessons Learned

1. **Floating-point header values:** Some providers (Groq) return fractional retry-after values - always use `parseFloat` for time-based headers
2. **402 vs 429:** OpenRouter uses 402 for credit exhaustion, not 429 - need to handle payment errors similarly to rate limits
3. **Test precision:** Use `toBeCloseTo()` for floating-point comparisons to avoid precision issues (8119.999999999999 vs 8120)

## Next Steps

No follow-up required. Both issues are fully resolved and tested.

## Related

- Quick task 001: Usage docs (CLI + API reference)
- Phase 3: Rate Limit Intelligence (original implementation of retry-after parsing)
- Decision d016: Three-state rate limit model (tracking state added between available and exhausted)
