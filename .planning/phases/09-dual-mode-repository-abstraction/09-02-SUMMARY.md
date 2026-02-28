---
phase: 09-dual-mode-repository-abstraction
plan: "02"
subsystem: persistence/routing
tags: [repository-pattern, dependency-injection, app-mode, dual-mode]
dependency_graph:
  requires:
    - 09-01  # interfaces.ts, factory.ts, SQLite wrappers, SaaS stubs
  provides:
    - route-interface-wiring  # routes consume IAdminRepository / IStatsRepository
    - app-mode-bootstrap      # index.ts resolves APP_MODE and calls createRepositories
  affects:
    - src/api/routes/admin.ts
    - src/api/routes/stats.ts
    - src/api/routes/chat.ts
    - src/index.ts
tech_stack:
  added: []
  patterns:
    - Repository interface injection into Hono route factories
    - Top-level await for async factory call in ESM entry point
    - APP_MODE env var resolution with safe default
key_files:
  created: []
  modified:
    - src/api/routes/admin.ts
    - src/api/routes/stats.ts
    - src/api/routes/chat.ts
    - src/index.ts
decisions:
  - "defaultChain added to AdminRouteDeps rather than exposing settings through IAdminRepository — keeps repository concerns clean"
  - "DELETE /providers and DELETE /chains become async handlers (await admin.deleteProvider/deleteChain) — Hono handles async handlers natively"
  - "configRef, requestLogger, aggregator remain alive in index.ts — still needed as deps passed to createRepositories factory"
metrics:
  duration_minutes: 10
  completed_date: "2026-03-01"
  tasks_completed: 2
  files_modified: 4
---

# Phase 09 Plan 02: Route Interface Wiring Summary

**One-liner:** Replaced concrete class injection in all three route factories with IAdminRepository/IStatsRepository interfaces and wired APP_MODE factory bootstrapping into index.ts.

## What Was Built

Route abstraction layer complete — all four files now use repository interfaces:

- **admin.ts** (`AdminRouteDeps`): Removed `configRef` and `configPath`, added `admin: IAdminRepository` and `defaultChain: string`. All 5 handlers (GET /config, PUT /providers, DELETE /providers, PUT /chains, DELETE /chains) now call repository methods.
- **stats.ts** (`createStatsRoutes`): Parameter changed from `UsageAggregator` to `IStatsRepository`. All 6 endpoint handlers updated to call `stats.*` methods.
- **chat.ts** (`createChatRoutes`): Parameter changed from `requestLogger: RequestLogger` to `stats: IStatsRepository`. All 6 `requestLogger.logRequest()` call sites replaced with `stats.logRequest()`.
- **index.ts**: Added APP_MODE resolution, top-level `await createRepositories(appMode, deps)` after DB init, and updated all three route wiring calls to pass `repos.admin` and `repos.stats`.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Refactor admin, stats, chat routes to accept repository interfaces | 73af25b | admin.ts, stats.ts, chat.ts |
| 2 | Wire APP_MODE factory into index.ts and validate full test suite | 79eed3e | index.ts |

## Verification Results

- `npm run typecheck` (tsc --noEmit): 0 errors
- `npm test`: 175/179 tests pass — 4 failures are pre-existing Windows EBUSY errors in cli.test.ts (resource busy on temp dir cleanup, unrelated to this plan)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing async] DELETE handlers needed async keyword**
- **Found during:** Task 1
- **Issue:** `deleteProvider` and `deleteChain` return `Promise<void>` per IAdminRepository, so the handlers needed `async` to use `await`.
- **Fix:** Changed DELETE /providers and DELETE /chains route handlers from `(c) =>` to `async (c) =>`.
- **Files modified:** src/api/routes/admin.ts
- **Commit:** 73af25b

**2. [Rule 1 - Logic order] PUT /providers registry.add moved before upsertProvider**
- **Found during:** Task 1
- **Issue:** Original code did config mutation then registry update then writeConfig. The plan said to call `registry.add` then `upsertProvider`. Keeping registry update first means a failure in upsertProvider leaves registry updated but persistence failed — consistent with original behavior where writeConfig was the last step.
- **Fix:** Kept `registry.add(id, adapter)` before `await admin.upsertProvider(providerConfig)` as specified in plan.
- **Files modified:** src/api/routes/admin.ts
- **Commit:** 73af25b

## Self-Check: PASSED

- src/api/routes/admin.ts: FOUND
- src/api/routes/stats.ts: FOUND
- src/api/routes/chat.ts: FOUND
- src/index.ts: FOUND
- 09-02-SUMMARY.md: FOUND
- Commit 73af25b: FOUND
- Commit 79eed3e: FOUND
