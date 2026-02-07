---
phase: quick-005
plan: 01
subsystem: proxy
tags: [timeout, waterfall, abort-signal, node20, hono]

# Dependency graph
requires:
  - phase: 01-01
    provides: core waterfall chain execution
provides:
  - Per-provider timeout configuration (optional, falls back to global requestTimeoutMs)
  - Timeout enforcement on every upstream request via AbortSignal.timeout
  - Timeout waterfall without cooldown (transient error, not rate limit)
  - Global requestTimeoutMs enforcement (previously never used)
affects: [config, adapter-creation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AbortSignal.timeout for per-request timeouts (Node 20+)"
    - "AbortSignal.any to combine timeout with client abort signal"
    - "TimeoutError vs AbortError distinction (Node 20+ error types)"

key-files:
  created: []
  modified:
    - src/config/schema.ts
    - src/providers/types.ts
    - src/providers/base-adapter.ts
    - src/providers/adapters/*.ts (all 4 adapters)
    - src/providers/registry.ts
    - src/chain/router.ts
    - src/api/routes/chat.ts
    - src/index.ts
    - config/config.example.yaml

key-decisions:
  - "Per-provider timeout overrides global requestTimeoutMs (adapter.timeout ?? globalTimeoutMs)"
  - "Timeout waterfalls WITHOUT cooldown (transient, not a rate limit)"
  - "TimeoutError check BEFORE AbortError in streaming (distinct error types)"
  - "globalTimeoutMs optional in executeStreamChain for test backward compat"

patterns-established:
  - "Per-provider config fields: add to schema → adapter interface → adapter constructors → registry.createAdapter"
  - "Timeout signals created per-attempt, not reused across chain entries"
  - "Streaming: combine signals with AbortSignal.any([timeout, clientAbort])"

# Metrics
duration: 7min
completed: 2026-02-08
---

# Quick Task 005: Per-Provider Timeout Configuration with Waterfall

**Per-provider timeout enforcement with AbortSignal.timeout on every upstream request, waterfall on timeout without cooldown, and global requestTimeoutMs finally used**

## Performance

- **Duration:** 7 min
- **Started:** 2026-02-08T12:22:31Z
- **Completed:** 2026-02-08T12:29:34Z
- **Tasks:** 2
- **Files modified:** 13

## Accomplishments

- Added optional `timeout` field to ProviderSchema (min 1000ms)
- Enforced timeout on every upstream request (non-streaming and streaming paths)
- Timeout waterfalls to next provider WITHOUT applying cooldown (transient error, not a rate limit)
- Per-provider timeout overrides global requestTimeoutMs when specified
- Fixed global requestTimeoutMs never being used (now threaded to chain executors)

## Task Commits

Each task was committed atomically:

1. **Task 1: Config schema + adapter timeout plumbing** - `2ef0951` (feat)
   - Added timeout field to config schema and ProviderAdapter interface
   - Updated all adapter constructors to accept and pass timeout
   - Registry passes config.timeout to adapter constructors
   - Example config shows Groq with 10s timeout

2. **Task 2: Chain executor timeout enforcement + chat route threading + tests** - `1b91e1d` (feat)
   - executeChain accepts globalTimeoutMs parameter
   - Per-attempt AbortSignal.timeout created (adapter.timeout ?? globalTimeoutMs)
   - TimeoutError waterfalls WITHOUT markExhausted (no cooldown)
   - Streaming: AbortSignal.any([timeout, clientAbort]) for combined signal
   - TimeoutError check BEFORE AbortError (distinct Node 20+ error types)
   - Chat routes thread globalTimeoutMs from config.settings.requestTimeoutMs
   - 4 new tests: timeout waterfall no-cooldown, streaming, per-provider, fallback

## Files Created/Modified

**Task 1:**
- `src/config/schema.ts` - Added timeout field to ProviderSchema
- `src/providers/types.ts` - Added timeout to ProviderAdapter interface
- `src/providers/base-adapter.ts` - Added timeout constructor param and property
- `src/providers/adapters/openrouter.ts` - Updated constructor to accept timeout
- `src/providers/adapters/groq.ts` - Updated constructor to accept timeout
- `src/providers/adapters/cerebras.ts` - Updated constructor to accept timeout
- `src/providers/adapters/generic-openai.ts` - Updated constructor to accept timeout
- `src/providers/registry.ts` - Pass config.timeout to adapter constructors
- `config/config.example.yaml` - Added timeout example (Groq: 10000ms)

**Task 2:**
- `src/chain/router.ts` - Timeout enforcement in executeChain and executeStreamChain
- `src/api/routes/chat.ts` - Thread globalTimeoutMs to chain executors
- `src/index.ts` - Pass config.settings.requestTimeoutMs to createChatRoutes
- `src/chain/__tests__/router.test.ts` - Updated all executeChain calls + 4 new timeout tests

## Decisions Made

1. **Per-provider timeout overrides global:** `adapter.timeout ?? globalTimeoutMs` pattern ensures per-provider config takes precedence
2. **Timeout waterfalls WITHOUT cooldown:** Timeouts are transient errors, not rate limits - no `tracker.markExhausted()` call
3. **TimeoutError before AbortError in streaming:** Node 20+ AbortSignal.timeout throws TimeoutError (distinct from AbortError). Check must come first to prevent treating timeout as client disconnect.
4. **globalTimeoutMs optional in executeStreamChain:** Keeps test backward compatibility while enabling production timeout enforcement
5. **Documented timeout in config.example.yaml:** Shows Groq with 10s timeout (provider known to hang sometimes)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all tests passed first try after implementation.

## Next Phase Readiness

- Timeout enforcement complete and tested
- Providers like Groq that hang will now waterfall after configurable timeout
- Per-provider timeout allows fast providers (10s) vs slow providers (60s)
- Global requestTimeoutMs now enforced as default (was previously ignored)

---
*Phase: quick-005*
*Completed: 2026-02-08*
