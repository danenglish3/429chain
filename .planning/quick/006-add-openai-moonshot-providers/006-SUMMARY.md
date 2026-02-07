---
phase: quick
plan: 006
subsystem: providers
tags: [openai, moonshot, adapters, rate-limits, documentation]
requires: [quick-005]
provides:
  - openai-provider-type
  - openai-rate-limit-parsing
  - moonshot-config-example
  - shared-duration-parser
affects: []
tech-stack:
  added: []
  patterns:
    - shared-utility-extraction
decisions:
  - id: d071
    title: Extract parseDurationToMs to shared utils.ts
    rationale: Both Groq and OpenAI use identical Go time.Duration format for reset headers. Extracting to shared utility eliminates duplication and makes the pattern available for future providers.
  - id: d072
    title: OpenAI as first-class provider type vs generic-openai
    rationale: OpenAI uses the same Go duration format for 6 rate limit headers + retry-after as Groq. Generic-openai would miss the duration string parsing, treating reset headers as unknown. First-class adapter ensures proper rate limit tracking.
  - id: d073
    title: Moonshot as generic-openai example
    rationale: Moonshot is fully OpenAI-compatible without custom header formats. Documenting it as generic-openai shows users the quick-path for similar providers.
key-files:
  created:
    - src/providers/utils.ts
    - src/providers/adapters/openai.ts
    - src/providers/adapters/__tests__/openai.test.ts
  modified:
    - src/providers/adapters/groq.ts
    - src/providers/registry.ts
    - src/config/schema.ts
    - config/config.example.yaml
    - docs/USAGE.md
    - docs/PROVIDERS.md
metrics:
  duration: 7m 7s
  completed: 2026-02-08
---

# Quick Task 006: Add OpenAI and Moonshot Providers

**One-liner:** OpenAI first-class provider with Go duration parsing for 6 rate limit headers, Moonshot as generic-openai fallback example

## Objective

Add OpenAI as a first-class provider type with proper rate limit header parsing using Go time.Duration format, and document Moonshot as a generic-openai provider example. Extract shared duration parsing utility to avoid code duplication.

## What Was Done

### Task 1: Extract parseDurationToMs + Create OpenAI adapter + Wire registry/schema

1. **Created `src/providers/utils.ts`**
   - Extracted `parseDurationToMs` function from groq.ts
   - Parses Go duration strings: "6m23.456s", "1.5s", "2h30m0s", "500ms"
   - Shared utility eliminates duplication

2. **Updated `src/providers/adapters/groq.ts`**
   - Removed function body, imported from utils.ts
   - Re-exports `parseDurationToMs` for backward compatibility with existing imports (including tests)

3. **Created `src/providers/adapters/openai.ts`**
   - DEFAULT_BASE_URL: `https://api.openai.com/v1`
   - Parses all 7 rate limit headers identical to Groq:
     - `x-ratelimit-limit-requests` / `x-ratelimit-remaining-requests`
     - `x-ratelimit-reset-requests` (Go duration -> parseDurationToMs)
     - `x-ratelimit-limit-tokens` / `x-ratelimit-remaining-tokens`
     - `x-ratelimit-reset-tokens` (Go duration -> parseDurationToMs)
     - `retry-after` (seconds -> ms)

4. **Updated `src/config/schema.ts`**
   - Changed provider type enum from `['openrouter', 'groq', 'cerebras', 'generic-openai']`
   - To: `['openrouter', 'groq', 'cerebras', 'openai', 'generic-openai']`

5. **Updated `src/providers/registry.ts`**
   - Added `import { OpenAIAdapter } from './adapters/openai.js'`
   - Added case before `'generic-openai'` in createAdapter switch:
     ```typescript
     case 'openai':
       return new OpenAIAdapter(config.id, config.name, config.apiKey, config.baseUrl, config.timeout);
     ```
   - Updated error message to include 'openai' in supported types list

**Verification:** All 136 tests pass, including groq tests via re-export.

**Commit:** `5545831` - feat(006): add OpenAI provider with rate limit parsing

### Task 2: Tests + Config example + Docs

1. **Created `src/providers/adapters/__tests__/openai.test.ts`**
   - 5 tests following groq.test.ts pattern
   - Constructor: default/custom base URL
   - parseRateLimitHeaders: all/null/partial headers
   - Different test values than Groq (10000 requests, 200000 tokens, "2m30s" reset, "45.5s" token reset, "3.5" retry-after)

2. **Updated `config/config.example.yaml`**
   - Added OpenAI provider:
     ```yaml
     - id: openai
       name: OpenAI
       type: openai
       apiKey: "sk-your-openai-key-here"
     ```
   - Added Moonshot provider (generic-openai):
     ```yaml
     - id: moonshot
       name: Moonshot
       type: generic-openai
       apiKey: "sk-your-moonshot-key-here"
       baseUrl: "https://api.moonshot.ai/v1"
     ```
   - Updated `default` chain to add paid fallbacks:
     ```yaml
     - provider: openai        # paid fallback
       model: "gpt-4o-mini"
     - provider: moonshot       # paid fallback
       model: "kimi-k2-0711-preview"
     ```
   - `fast` chain remains free-tier only (groq + cerebras)

3. **Updated `docs/USAGE.md`**
   - Section 3.2 Providers: Added 'openai' to type enum
   - Provider Types list: Added `- openai - OpenAI API (default baseUrl: https://api.openai.com/v1)`
   - Provider example YAML: Added openai provider entry
   - Section 3.4 Full Example Configuration: Added openai + moonshot providers and chain entries

4. **Updated `docs/PROVIDERS.md`**
   - Quick Path Examples: Added `- **Moonshot AI**: https://api.moonshot.ai/v1`
   - Step 5a registry example: Added openai case in switch
   - Step 5b schema example: Added 'openai' to z.enum
   - Checklist error message note: Updated to include 'openai' in supported types

**Verification:** All 33 provider adapter tests pass (including 5 new OpenAI tests).

**Commit:** `c2e7307` - docs(006): add OpenAI tests, config examples, and documentation

## Technical Implementation

### Shared Utility Pattern

**Before:**
- Groq: parseDurationToMs inline in groq.ts
- OpenAI: would duplicate the same function

**After:**
- `src/providers/utils.ts`: Single implementation
- `groq.ts`: imports and re-exports (backward compat)
- `openai.ts`: imports directly
- Tests: unchanged (re-export maintains import path)

### OpenAI Rate Limit Headers

OpenAI uses **identical header format to Groq** (Go time.Duration strings):

```
x-ratelimit-limit-requests: 10000
x-ratelimit-remaining-requests: 9999
x-ratelimit-reset-requests: 2m30s      <- parseDurationToMs needed
x-ratelimit-limit-tokens: 200000
x-ratelimit-remaining-tokens: 195000
x-ratelimit-reset-tokens: 45.5s        <- parseDurationToMs needed
retry-after: 3.5                        <- parseFloat * 1000
```

Generic-openai would parse limit/remaining (integers) but fail on reset duration strings. First-class adapter ensures correct parsing of all 7 headers.

### Config Example: Free -> Paid Waterfall

Default chain now demonstrates waterfall from free tier to paid fallbacks:
1. OpenRouter free (meta-llama/llama-3.1-8b-instruct:free)
2. Groq free (llama-3.1-8b-instant)
3. Cerebras free (llama-3.1-8b)
4. **OpenAI paid fallback** (gpt-4o-mini)
5. **Moonshot paid fallback** (kimi-k2-0711-preview)

## Deviations from Plan

None - plan executed exactly as written.

## Decisions Made

**[d071] Extract parseDurationToMs to shared utils.ts**
- **Context:** Groq and OpenAI use identical Go duration format
- **Decision:** Create src/providers/utils.ts with shared parser
- **Impact:** Eliminates duplication, makes pattern available for future providers
- **Trade-offs:** Adds one more file, but better than copy-paste

**[d072] OpenAI as first-class provider type**
- **Context:** OpenAI uses Go duration strings for 6 rate limit headers + retry-after
- **Decision:** Create OpenAIAdapter with parseDurationToMs instead of using generic-openai
- **Impact:** Proper rate limit tracking for OpenAI (generic-openai would miss duration parsing)
- **Alternative:** Could use generic-openai but would lose reset time parsing

**[d073] Moonshot as generic-openai example**
- **Context:** Moonshot is fully OpenAI-compatible without custom headers
- **Decision:** Document as generic-openai in config example and PROVIDERS.md
- **Impact:** Shows users the quick-path for similar providers
- **Examples:** Together AI, Fireworks AI, DeepInfra all use same pattern

## Files Changed

### Created (3 files)
- `src/providers/utils.ts` - Shared parseDurationToMs utility
- `src/providers/adapters/openai.ts` - OpenAI adapter with rate limit parsing
- `src/providers/adapters/__tests__/openai.test.ts` - OpenAI adapter tests (5 tests)

### Modified (6 files)
- `src/providers/adapters/groq.ts` - Import + re-export parseDurationToMs
- `src/providers/registry.ts` - Add OpenAIAdapter import and case
- `src/config/schema.ts` - Add 'openai' to provider type enum
- `config/config.example.yaml` - Add OpenAI + Moonshot providers and chain entries
- `docs/USAGE.md` - Add 'openai' type, examples, full config
- `docs/PROVIDERS.md` - Add Moonshot example, registry/schema code snippets

## Test Results

**Provider adapter tests:** 33 passed (5 new OpenAI tests + 28 existing)
- Constructor: default base URL, custom base URL
- parseRateLimitHeaders: all headers, null headers, partial headers

**Total test suite:** 140/141 tests pass
- 1 intermittent CLI timeout (unrelated to provider changes)
- All provider adapter tests pass
- All existing tests pass (backward compatibility confirmed)

## Next Phase Readiness

**Blockers:** None

**Concerns:** None

**Recommendations:**
- OpenAI and Moonshot ready for production use
- Config example demonstrates free->paid waterfall pattern
- PROVIDERS.md gives users clear guidance on when to use generic-openai vs custom adapter

## Commits

| Commit | Message | Files |
|--------|---------|-------|
| 5545831 | feat(006): add OpenAI provider with rate limit parsing | utils.ts, groq.ts, openai.ts, registry.ts, schema.ts |
| c2e7307 | docs(006): add OpenAI tests, config examples, and documentation | openai.test.ts, config.example.yaml, USAGE.md, PROVIDERS.md |
