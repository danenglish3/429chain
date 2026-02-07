---
phase: quick
plan: 004
subsystem: docs
tags: [provider-adapters, developer-guide, BaseAdapter, rate-limits]

# Dependency graph
requires:
  - phase: 01-core
    provides: Provider adapter architecture (BaseAdapter, registry, types)
  - phase: 03-rate-limits
    provides: RateLimitInfo interface and header parsing patterns
provides:
  - Comprehensive developer guide for adding new provider adapters
  - Documentation of both quick path (generic-openai) and full custom adapter path
  - Real code examples from existing adapters (Groq, OpenRouter, Cerebras)
  - Test template following existing Vitest patterns
affects: [future contributors, provider support expansion]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Documentation structure: quick path then full path with step-by-step walkthrough
    - Real code examples over fictional snippets

key-files:
  created:
    - docs/PROVIDERS.md
  modified: []

key-decisions:
  - "Use real adapter code as examples (Groq duration parsing, OpenRouter timestamp conversion, Cerebras parameter stripping)"
  - "Structure guide as quick path first (generic-openai config) then full path (custom adapter class)"
  - "Include complete registration steps with exact code for registry.ts and schema.ts"

patterns-established:
  - "Developer guides use actual codebase patterns, not invented examples"
  - "Step-by-step walkthrough with hypothetical 'Acme AI' provider as running example"

# Metrics
duration: 1.6min
completed: 2026-02-08
---

# Quick Task 004: Provider Adapter Creation Guide

**Comprehensive 536-line developer guide enabling contributors to add provider support via generic-openai config or custom adapter classes**

## Performance

- **Duration:** 1.6 minutes
- **Started:** 2026-02-08T04:41:46Z
- **Completed:** 2026-02-08T04:43:22Z
- **Tasks:** 1
- **Files created:** 1

## Accomplishments

- Created docs/PROVIDERS.md covering both extension paths
- Quick path documentation for generic-openai config with real examples (Together AI, Fireworks)
- Full custom adapter walkthrough with step-by-step implementation guide
- Real code examples from Groq (duration parsing), OpenRouter (timestamp conversion), Cerebras (parameter stripping)
- Registration steps with exact code snippets for registry.ts and schema.ts
- Test template following existing Vitest patterns from groq.test.ts
- Architecture reference explaining BaseAdapter responsibilities and waterfall flow
- Developer checklist for new adapter implementation

## Task Commits

1. **Task 1: Write the provider adapter guide** - `c65698f` (docs)

## Files Created/Modified

- `docs/PROVIDERS.md` - Developer-facing guide for adding provider support (536 lines)

## Decisions Made

**Use real adapter code as examples**: Guide references actual implementation patterns from existing adapters (Groq's `parseDurationToMs()`, OpenRouter's Unix timestamp conversion, Cerebras's parameter stripping) rather than inventing fictional patterns. This ensures accuracy and provides copy-paste-ready code.

**Quick path first, full path second**: Structure prioritizes the generic-openai quick path (config-only) before the full custom adapter path. Most OpenAI-compatible providers can use the quick path, so developers see the simplest solution first.

**Complete registration steps with exact code**: Include specific code snippets showing where to add imports, switch cases, and enum values in registry.ts and schema.ts. Developers can copy-paste rather than reverse-engineer the registration pattern.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Guide ready for contributor use
- Enables community to add provider support without deep codebase knowledge
- All three extension points documented: parseRateLimitHeaders, prepareRequestBody, getExtraHeaders
- Test template ensures new adapters follow existing quality standards

---
*Quick Task: 004*
*Completed: 2026-02-08*
