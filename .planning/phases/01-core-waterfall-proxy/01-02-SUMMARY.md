---
phase: 01-core-waterfall-proxy
plan: 02
subsystem: api
tags: [providers, adapters, openrouter, groq, cerebras, rate-limits, registry]
dependency-graph:
  requires:
    - phase: 01-01
      provides: config types (ProviderConfig), error classes (ProviderError, ProviderRateLimitError), logger, OpenAI types (ChatCompletionRequest/Response)
  provides:
    - ProviderAdapter interface and ProviderResponse/RateLimitInfo types
    - BaseAdapter abstract class with shared HTTP fetch logic
    - OpenRouterAdapter with X-RateLimit-* header parsing and HTTP-Referer/X-Title headers
    - GroqAdapter with dual request/token rate limit parsing and duration string parser
    - CerebrasAdapter with presence_penalty/frequency_penalty stripping and day/minute headers
    - GenericOpenAIAdapter for custom OpenAI-compatible providers
    - ProviderRegistry class with O(1) Map-based lookup
    - buildRegistry factory function from ProviderConfig[]
  affects: [01-03, 01-04]
tech-stack:
  added: []
  patterns: [provider-adapter-pattern, abstract-base-with-concrete-adapters, factory-registry]
key-files:
  created:
    - src/providers/types.ts
    - src/providers/base-adapter.ts
    - src/providers/adapters/openrouter.ts
    - src/providers/adapters/groq.ts
    - src/providers/adapters/cerebras.ts
    - src/providers/adapters/generic-openai.ts
    - src/providers/registry.ts
  modified: []
key-decisions:
  - "ProviderRegistry interface added to types.ts for decoupled chain router consumption"
  - "GenericOpenAIAdapter created for generic-openai provider type with standard header parsing"
  - "Groq duration parser hand-written (parseDurationToMs) since ms package cannot handle compound durations like 6m23.456s"
patterns-established:
  - "Provider adapter pattern: all provider-specific logic (headers, parsing, param stripping) encapsulated in adapter classes"
  - "BaseAdapter provides shared fetch, auth, latency measurement; concrete adapters override only what differs"
  - "Registry factory pattern: buildRegistry(ProviderConfig[]) creates typed adapter instances via switch on type field"
metrics:
  duration: ~8min
  completed: 2026-02-05
---

# Phase 01 Plan 02: Provider Adapter Layer and Registry Summary

**Three provider adapters (OpenRouter, Groq, Cerebras) with per-provider rate limit header parsing, a generic OpenAI adapter, base adapter with shared fetch logic, and a registry factory mapping config to adapter instances**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-02-05T17:40:57Z
- **Completed:** 2026-02-05T17:48:14Z
- **Tasks:** 2
- **Files created:** 7

## Accomplishments
- ProviderAdapter interface, ProviderResponse, and RateLimitInfo types define the uniform contract for all providers
- BaseAdapter abstract class handles shared HTTP fetch, latency measurement, error detection, and 429 handling
- Three concrete adapters handle provider-specific quirks: OpenRouter extra headers, Groq duration string parsing, Cerebras unsupported parameter stripping
- ProviderRegistry with O(1) lookup and descriptive error messages for missing providers
- All 47 existing tests pass (no regressions), TypeScript compiles with zero errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Provider types, base adapter, and three concrete adapters** - `8fabae3` (feat)
2. **Task 2: Provider registry** - `4b5009b` (feat)

## Files Created/Modified
- `src/providers/types.ts` - ProviderAdapter interface, ProviderResponse, RateLimitInfo, ProviderRegistry interface
- `src/providers/base-adapter.ts` - Abstract BaseAdapter with shared fetch, auth headers, latency, error detection
- `src/providers/adapters/openrouter.ts` - OpenRouterAdapter with HTTP-Referer/X-Title headers and X-RateLimit-* parsing
- `src/providers/adapters/groq.ts` - GroqAdapter with dual request/token rate limits and parseDurationToMs helper
- `src/providers/adapters/cerebras.ts` - CerebrasAdapter stripping presence_penalty/frequency_penalty, day/minute headers
- `src/providers/adapters/generic-openai.ts` - GenericOpenAIAdapter for custom OpenAI-compatible endpoints
- `src/providers/registry.ts` - ProviderRegistry class and buildRegistry factory function

## Decisions Made

1. **ProviderRegistry interface in types.ts**: Added a ProviderRegistry interface alongside ProviderAdapter so the chain router can depend on the interface rather than the concrete class. Enables testing with mock registries.

2. **GenericOpenAIAdapter**: Created a concrete adapter for the `generic-openai` provider type defined in the config schema. It uses standard OpenAI-style rate limit headers and requires an explicit baseUrl. This was mentioned in the plan but not fully specified.

3. **Hand-written duration parser**: Groq returns reset times as compound duration strings like `"6m23.456s"`. The `ms` package cannot parse these, so a custom `parseDurationToMs` function was written to handle hours, minutes, seconds, and milliseconds components.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created GenericOpenAIAdapter for generic-openai provider type**
- **Found during:** Task 2 (Registry implementation)
- **Issue:** The registry's switch statement handles `generic-openai` type from config schema, but no adapter existed for it. The plan mentioned "new BaseAdapter subclass or a GenericOpenAIAdapter" but didn't include it in Task 1 files.
- **Fix:** Created `src/providers/adapters/generic-openai.ts` with standard OpenAI-style header parsing and no special quirks.
- **Files modified:** src/providers/adapters/generic-openai.ts (new)
- **Verification:** TypeScript compiles, registry builds with generic-openai type
- **Committed in:** `4b5009b` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to support generic-openai provider type already defined in config schema. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness

Plan 01-03 (Chain router with waterfall execution) can proceed immediately. All prerequisites are delivered:
- ProviderAdapter interface and concrete adapters are ready for the chain router to call
- ProviderRegistry provides the lookup mechanism the router needs
- RateLimitInfo type is ready for the rate limit tracker to consume
- ProviderRateLimitError carries response headers for cooldown extraction
- All adapters use the shared logger with API key redaction

---
*Phase: 01-core-waterfall-proxy*
*Completed: 2026-02-05*
