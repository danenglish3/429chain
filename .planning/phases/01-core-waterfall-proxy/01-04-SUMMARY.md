---
phase: 01-core-waterfall-proxy
plan: 04
subsystem: api
tags: [hono, http, auth, middleware, openai-compatible, routes, server]
dependency-graph:
  requires:
    - phase: 01-01
      provides: config loader, logger, error classes, OpenAI types
    - phase: 01-02
      provides: provider adapters, ProviderRegistry, buildRegistry factory
    - phase: 01-03
      provides: RateLimitTracker, executeChain, resolveChain, buildChains, Chain types
  provides:
    - createAuthMiddleware for API key validation on protected routes
    - errorHandler converting all error types to OpenAI-format JSON
    - POST /v1/chat/completions with chain resolution and waterfall execution
    - GET /v1/models returning deduplicated models from all chains in OpenAI list format
    - GET /health returning proxy status without authentication
    - Application entry point bootstrapping config, registry, chains, tracker, and Hono server
    - Graceful shutdown cancelling cooldown timers and closing server
  affects: [02-01, 02-02, 03-01]
tech-stack:
  added: []
  patterns: [factory-route-pattern, dependency-injection-via-closures, hono-sub-app-mounting]
key-files:
  created:
    - src/api/middleware/auth.ts
    - src/api/middleware/error-handler.ts
    - src/api/routes/chat.ts
    - src/api/routes/models.ts
    - src/api/routes/health.ts
  modified:
    - src/index.ts
    - src/providers/types.ts
    - src/chain/__tests__/router.test.ts
key-decisions:
  - "Route factory pattern: createChatRoutes/createModelsRoutes/createHealthRoutes take dependencies as params and return Hono sub-apps"
  - "Hono sub-app mounting: /v1 sub-app has auth middleware applied via use('*'), /health mounted directly on root app without auth"
  - "Model field as chain name hint: request model field selects chain if it matches a chain name, otherwise uses default"
patterns-established:
  - "Factory route pattern: route creators receive dependencies and return configured Hono instances"
  - "Selective auth: mount unauthenticated routes on root app, authenticated routes on a sub-app with middleware"
  - "OpenAI error format everywhere: all error handlers produce { error: { message, type, param, code } }"
metrics:
  duration: ~4min
  completed: 2026-02-05
---

# Phase 01 Plan 04: HTTP Layer, Auth, Routes, and Entry Point Summary

**Hono HTTP server with Bearer auth middleware, OpenAI-compatible /v1/chat/completions and /v1/models endpoints, health check, OpenAI-format error handler, and entry point wiring config/registry/chains/tracker into a running proxy on port 3429**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-02-05T04:51:34Z
- **Completed:** 2026-02-05T04:55:19Z
- **Tasks:** 2
- **Files created/modified:** 8

## Accomplishments
- Full HTTP layer for 429chain: auth, error handling, chat completions, models listing, health check
- Server boots from YAML config, builds provider registry and chains, starts Hono with @hono/node-server
- Auth middleware protects /v1/* routes while /health remains public
- Chat completions route resolves chain from model field, executes waterfall, returns X-429chain-Provider and X-429chain-Attempts headers
- All error types (AllProvidersExhausted, ProviderRateLimit, Config, unknown) produce OpenAI-format JSON responses
- Phase 1 functionally complete: non-streaming waterfall proxy with auth, health, models, and detailed error reporting

## Task Commits

Each task was committed atomically:

1. **Task 1: Auth middleware, error handler, and route handlers** - `711056d` (feat)
2. **Task 2: Application entry point and server bootstrap** - `a62ba52` (feat)

## Files Created/Modified
- `src/api/middleware/auth.ts` - createAuthMiddleware factory with Bearer token validation
- `src/api/middleware/error-handler.ts` - errorHandler mapping errors to OpenAI format (502/429/500)
- `src/api/routes/chat.ts` - POST /chat/completions with chain resolution and waterfall execution
- `src/api/routes/models.ts` - GET /models returning deduplicated models from all chains
- `src/api/routes/health.ts` - GET / returning proxy status, version, uptime, counts
- `src/index.ts` - Entry point: bootstrap config -> registry -> chains -> tracker -> Hono -> serve
- `src/providers/types.ts` - Added `size` property to ProviderRegistry interface
- `src/chain/__tests__/router.test.ts` - Added `size` to mock registry to match updated interface

## Decisions Made

1. **Route factory pattern with dependency injection**: Route creators (createChatRoutes, createModelsRoutes, createHealthRoutes) accept dependencies as parameters and return Hono sub-apps. This keeps the dependency graph explicit and makes unit testing straightforward.

2. **Hono sub-app mounting for selective auth**: Unauthenticated routes (health) mount directly on the root app. Authenticated routes mount on a `/v1` sub-app that has `use('*', auth)`. Clean separation without per-route auth checks.

3. **Model field as chain name hint**: The `model` field from OpenAI SDK requests is used to select a chain by name. If no chain matches, the default chain is used. This allows `model: "fast"` to select the "fast" chain without any client library changes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `size` property to ProviderRegistry interface**
- **Found during:** Task 1 (Health route implementation)
- **Issue:** The health route needs `registry.size` to report provider count, but the ProviderRegistry interface in `providers/types.ts` only had `get()`, `has()`, and `getAll()`. The concrete class had `size` but the interface didn't.
- **Fix:** Added `readonly size: number` to the ProviderRegistry interface. Also updated the mock registry in `chain/__tests__/router.test.ts` to implement the new property.
- **Files modified:** src/providers/types.ts, src/chain/__tests__/router.test.ts
- **Verification:** `npx tsc --noEmit` passes, all 47 tests pass
- **Committed in:** `711056d` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Interface-only addition required for health route to compile. The concrete ProviderRegistry class already had the `size` getter. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. The test config file (config/config.yaml) is gitignored.

## Verification Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` zero errors | PASS |
| `npx vitest run` 47/47 tests pass | PASS |
| Server starts with `npx tsx src/index.ts` | PASS |
| GET /health returns 200 without auth | PASS |
| GET /v1/models returns 401 without auth | PASS |
| GET /v1/models returns 200 with valid auth | PASS |
| Invalid API key returns 401 OpenAI-format error | PASS |
| POST /v1/chat/completions waterfalls through providers | PASS |
| All providers failing returns 502 with attempt listing | PASS |
| Graceful shutdown exits cleanly on SIGTERM | PASS |

## Next Phase Readiness

Phase 1 (Core Waterfall Proxy) is now functionally complete. A developer can:
- Point an OpenAI SDK at `http://localhost:3429`
- Authenticate with a configured API key
- Make chat completion requests that waterfall through provider chains
- Get OpenAI-compatible responses (or detailed error messages)
- View available models via GET /v1/models
- Check proxy health via GET /health

Phase 2 (Streaming SSE Support) can proceed. All prerequisites are delivered:
- Hono application structure with route factories accepting dependencies
- Auth middleware pattern for protecting new endpoints
- Error handler for new error types
- Chain execution infrastructure for streaming variants

---
*Phase: 01-core-waterfall-proxy*
*Completed: 2026-02-05*
