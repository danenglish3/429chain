---
phase: quick
plan: 008
subsystem: api
tags: [reasoning-models, deepseek, normalization, response-transformation]

# Dependency graph
requires:
  - phase: 01
    provides: OpenAI-compatible API types and chat route structure
provides:
  - Optional response normalization for reasoning models via config flag
  - Pure normalize functions with comprehensive tests
  - Streaming and non-streaming reasoning_content transformation
affects: [reasoning-model-usage, api-clients]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Pure normalize functions with defensive error handling for streaming
    - Config-driven feature flags with zero-impact defaults

key-files:
  created:
    - src/shared/normalize.ts
    - src/shared/__tests__/normalize.test.ts
  modified:
    - src/config/schema.ts
    - src/shared/types.ts
    - src/api/routes/chat.ts
    - src/index.ts
    - config/config.example.yaml

key-decisions:
  - "normalizeResponses defaults to false for backward compatibility"
  - "Only move reasoning_content when content is null/empty (never overwrite existing content)"
  - "Streaming normalization happens after usage capture (defensive try-catch for malformed JSON)"

patterns-established:
  - "Config flags for optional transformations with zero-impact defaults"
  - "Pure normalize functions with explicit mutation contracts"

# Metrics
duration: 5min
completed: 2026-02-08
---

# Quick Task 008: Normalize Reasoning Content Summary

**Config-driven reasoning_content normalization ensures DeepSeek R1 and similar reasoning models appear in standard content field for downstream consumers**

## Performance

- **Duration:** 5 minutes
- **Started:** 2026-02-08T13:22:11Z
- **Completed:** 2026-02-08T13:27:08Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Added normalizeResponses config flag (default: false) to SettingsSchema
- Created normalize.ts with pure normalizeResponse and normalizeChunk functions
- Wrote 12 comprehensive unit tests covering edge cases (null, empty, existing content, malformed JSON, [DONE] marker)
- Wired normalization into both streaming and non-streaming chat paths
- Zero behavioral change when flag is false (default)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add normalizeResponses config flag and create normalize utility with tests** - `f400e1a` (feat)
2. **Task 2: Wire normalize functions into chat routes** - `45c393e` (feat)

## Files Created/Modified
- `src/shared/normalize.ts` - Pure normalize functions for reasoning_content transformation
- `src/shared/__tests__/normalize.test.ts` - 12 unit tests for normalize functions
- `src/config/schema.ts` - Added normalizeResponses boolean field (default: false)
- `src/shared/types.ts` - Added reasoning_content optional field to ChatCompletionChoice.message and ChatCompletionDelta
- `src/api/routes/chat.ts` - Import and apply normalize functions in streaming and non-streaming paths
- `src/index.ts` - Pass config.settings.normalizeResponses to createChatRoutes
- `config/config.example.yaml` - Added normalizeResponses setting with explanatory comment

## Decisions Made

**1. Default to false for backward compatibility**
- Existing behavior unchanged unless users explicitly opt in
- No impact on current deployments

**2. Never overwrite existing content**
- Only move reasoning_content when content is null, undefined, or empty string
- Preserves real content if both fields present (future reasoning models may use both)

**3. Defensive streaming normalization**
- Try-catch wrapper in normalizeChunk returns original data on parse errors
- Never break streaming due to unexpected format
- Usage capture happens before normalization (unaffected by transformation)

**4. Pure functions with explicit mutation**
- normalizeResponse mutates in place (efficiency for large responses)
- normalizeChunk returns new string (streaming safety)
- Both documented with explicit mutation contracts

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - implementation was straightforward. All tests passed on first run.

## User Setup Required

None - feature is opt-in via config flag. Default behavior unchanged.

## Next Phase Readiness

- Ready for use with DeepSeek R1 and similar reasoning models
- Clients that only read content field will now see reasoning output when normalizeResponses: true
- No breaking changes - existing configs continue to work without modification

---
*Quick Task: 008*
*Completed: 2026-02-08*
