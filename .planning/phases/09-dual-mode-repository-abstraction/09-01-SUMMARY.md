---
phase: 09-dual-mode-repository-abstraction
plan: 01
subsystem: database
tags: [repository-pattern, typescript, sqlite, interfaces, factory, dynamic-import]

# Dependency graph
requires:
  - phase: 04-observability-and-persistence
    provides: UsageAggregator, RequestLogger, writeConfig — the concrete classes the SQLite repositories delegate to
provides:
  - IAdminRepository and IStatsRepository interfaces (zero runtime weight, import type only)
  - SqliteAdminRepository delegating to configRef + writeConfig
  - SqliteStatsRepository delegating to UsageAggregator + RequestLogger
  - SaasAdminRepository and SaasStatsRepository stubs (throw on all methods)
  - createRepositories factory with dynamic imports for mode isolation
affects:
  - 09-02 (route wiring — consumes Repositories type and createRepositories)
  - 10 (SaaS auth — will call createRepositories with mode='saas')
  - 11 (SaaS persistence — will implement SaasAdminRepository and SaasStatsRepository)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Repository pattern with interface + SQLite/SaaS implementations
    - Dynamic import for mode isolation (ARCH-07 — no static imports of saas/ anywhere)
    - import type only in interfaces.ts (zero circular dep risk)
    - Delegating wrappers — zero business logic in repositories, all in route handlers

key-files:
  created:
    - src/persistence/repositories/interfaces.ts
    - src/persistence/repositories/sqlite/admin.ts
    - src/persistence/repositories/sqlite/stats.ts
    - src/persistence/repositories/saas/admin.ts
    - src/persistence/repositories/saas/stats.ts
    - src/persistence/repositories/factory.ts
  modified: []

key-decisions:
  - "getConfig() is synchronous — both SQLite (in-memory ref) and future SaaS (cached) return immediately; write methods are Promise<void> for future async Postgres compat"
  - "Both self-hosted and saas factory branches use dynamic await import() — keeps module loading consistent and prevents bundler from including unused mode at build time"
  - "SaaS stubs use 'Phase 11' in error messages — makes the placeholder origin explicit in runtime errors"
  - "Repositories hold ZERO business logic — validation, registry updates, runtime chain-map updates, and default-chain guards stay in route handlers (Plan 02)"

patterns-established:
  - "Dynamic import isolation: factory.ts is the ONLY file that may import from sqlite/ or saas/ — all other files import from interfaces.ts or factory.ts only"
  - "Delegation-only repositories: every method is a one-liner forwarding to an injected dependency; no logic lives in the repository classes themselves"

requirements-completed: [ARCH-03, ARCH-04, ARCH-06, ARCH-07]

# Metrics
duration: 2min
completed: 2026-03-01
---

# Phase 9 Plan 01: Dual-Mode Repository Abstraction — Interfaces and Factory

**IAdminRepository + IStatsRepository interfaces with SQLite delegating wrappers, SaaS stubs, and a dynamic-import factory selecting implementations by APP_MODE**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-28T22:13:37Z
- **Completed:** 2026-02-28T22:15:17Z
- **Tasks:** 2
- **Files modified:** 6 (all created)

## Accomplishments

- Established IAdminRepository (5 methods) and IStatsRepository (7 methods) as zero-runtime interfaces using import type only
- Created SqliteAdminRepository delegating to configRef + writeConfig and SqliteStatsRepository delegating to UsageAggregator + RequestLogger — both with zero logic
- Created SaasAdminRepository and SaasStatsRepository stubs that throw descriptive errors on every method
- Created createRepositories factory that uses dynamic await import() for both branches, ensuring ARCH-07 isolation (no static imports of saas/ files anywhere)

## Task Commits

Each task was committed atomically:

1. **Task 1: Define repository interfaces and create SQLite + SaaS implementations** - `0dad37d` (feat)
2. **Task 2: Create repository factory with dynamic SaaS imports** - `5e725d7` (feat)

## Files Created/Modified

- `src/persistence/repositories/interfaces.ts` - IAdminRepository and IStatsRepository interfaces (import type only, zero runtime weight)
- `src/persistence/repositories/sqlite/admin.ts` - SqliteAdminRepository delegating to configRef + writeConfig
- `src/persistence/repositories/sqlite/stats.ts` - SqliteStatsRepository delegating to UsageAggregator + RequestLogger
- `src/persistence/repositories/saas/admin.ts` - SaasAdminRepository stub throwing on all 5 methods
- `src/persistence/repositories/saas/stats.ts` - SaasStatsRepository stub throwing on all 7 methods
- `src/persistence/repositories/factory.ts` - createRepositories factory with AppMode type and Repositories interface

## Decisions Made

- getConfig() is synchronous because both the SQLite implementation (in-memory ref) and the future SaaS implementation (cached) return immediately — no need for async at the interface level
- Write methods (upsertProvider, deleteProvider, upsertChain, deleteChain) are Promise<void> to accommodate future async Postgres writes without an interface change
- Both self-hosted and saas branches in the factory use dynamic await import() — keeps the pattern consistent and prevents any mode's files from being bundled into the other mode's load path
- Repositories contain zero business logic — this was an explicit design constraint from the plan to keep the abstraction clean

## Deviations from Plan

None — plan executed exactly as written. Task 1 files were already present on disk (uncommitted), verified correct against plan spec, committed as-is.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 6 repository files created and TypeScript-verified (npx tsc --noEmit passes)
- Plan 02 can now wire createRepositories into index.ts and update admin/stats/chat routes to accept repository interfaces
- SaaS stubs will remain as placeholders until Phase 11 implements Postgres/Supabase persistence

---
*Phase: 09-dual-mode-repository-abstraction*
*Completed: 2026-03-01*
