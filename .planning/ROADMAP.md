# Roadmap: 429chain

## Milestones

- **v1.0 MVP** — Phases 1-7 (shipped 2026-02-06)
- **v1.1 SaaS Ready** — Phases 9-14 (in progress)

## Phases

<details>
<summary>v1.0 MVP (Phases 1-7) — SHIPPED 2026-02-06</summary>

- [x] Phase 1: Core Waterfall Proxy (4/4 plans) — completed 2026-02-05
- [x] Phase 2: SSE Streaming (2/2 plans) — completed 2026-02-05
- [x] Phase 3: Rate Limit Intelligence (4/4 plans) — completed 2026-02-05
- [x] Phase 4: Observability & Persistence (3/3 plans) — completed 2026-02-05
- [x] Phase 5: Web UI (6/6 plans) — completed 2026-02-06
- [x] Phase 6: Docker Deployment (3/3 plans) — completed 2026-02-06
- [x] Phase 7: CLI Support (3/3 plans) — completed 2026-02-06

See: `.planning/milestones/v1.0-ROADMAP.md` for full details.

</details>

<details>
<summary>Phase 8: Queue Mode — COMPLETE 2026-02-27</summary>

**Goal:** Add FIFO queue mode so requests wait for provider cooldowns instead of immediately failing with "All providers exhausted"

Plans:
- [x] 08-01: TDD RequestQueue class with types, errors, config schema
- [x] 08-02: Wire queue into tracker, chat routes, ratelimits, index.ts, shutdown
- [x] 08-03: Update config example and API documentation

</details>

---

### v1.1 SaaS Ready (Phases 9-14)

**Milestone Goal:** Make 429chain deployable as a multi-tenant SaaS while preserving the existing self-hosted open-source experience.

- [x] **Phase 9: Dual-Mode Repository Abstraction** - Define repository interfaces, wrap SQLite behind them, add mode-switching factory (completed 2026-02-28)
- [ ] **Phase 10: Postgres Schema and RLS** - Write Postgres migrations with tenant isolation policies and encrypted key storage
- [ ] **Phase 11: Supabase Repository Implementations** - Implement Postgres-backed repositories and wire them into the factory
- [ ] **Phase 12: Hono Auth Middleware and SaaS Route Wiring** - JWT validation middleware, per-tenant chat path, tenant API key resolution
- [ ] **Phase 13: Frontend Auth Layer** - Login/signup pages, AuthContext, ProtectedRoute, and tenant-scoped UI views
- [ ] **Phase 14: End-to-End Integration and Deployment Config** - Cross-tenant isolation validation, Docker Compose SaaS config, deployment documentation

## Phase Details

### Phase 9: Dual-Mode Repository Abstraction
**Goal**: Self-hosted mode routes through typed repository interfaces with zero behavior change; SaaS mode selection is wired but returns unimplemented stubs
**Depends on**: Phase 8 complete
**Requirements**: ARCH-01, ARCH-02, ARCH-03, ARCH-04, ARCH-06, ARCH-07
**Success Criteria** (what must be TRUE):
  1. Running the app with no APP_MODE env var produces identical behavior to today (same routes, same data, same responses)
  2. Running with APP_MODE=saas starts the server and logs "saas mode" without importing any Supabase packages
  3. A developer can swap SQLite for a different backend by implementing IAdminRepository and IStatsRepository alone
  4. The CI matrix job passes for APP_MODE=self-hosted with no Supabase env vars present
  5. All existing tests continue to pass through the new SQLite repository wrappers
**Plans**: 2 plans

Plans:
- [ ] 09-01: Repository interfaces, SQLite wrappers, SaaS stubs, and factory
- [ ] 09-02: Wire repository interfaces into routes and index.ts bootstrap

### Phase 10: Postgres Schema and RLS
**Goal**: A Postgres schema exists in Supabase with all tenant tables protected by Row Level Security policies that enforce per-user data isolation
**Depends on**: Phase 9
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-06
**Success Criteria** (what must be TRUE):
  1. Running the migration script creates providers, chains, chain_entries, and request_logs tables with a user_id column on each
  2. Attempting to INSERT a row without auth.uid() matching user_id is rejected by the database
  3. A query from user A cannot return rows owned by user B regardless of query structure
  4. Unique constraint violations for duplicate names are scoped per user (user A and user B can both have a chain named "default")
  5. Provider API keys written to the database are stored as ciphertext, not plaintext
**Plans**: TBD

### Phase 11: Supabase Repository Implementations
**Goal**: The factory selects Supabase Postgres repositories in SaaS mode; both repository implementations pass the same behavior contract tests
**Depends on**: Phase 10
**Requirements**: ARCH-05, DATA-05, DATA-07, DATA-08
**Success Criteria** (what must be TRUE):
  1. In SaaS mode, provider and chain CRUD operations read and write to Postgres, not SQLite
  2. A user can add a provider API key that is visible only in their own session and invisible to other tenants
  3. Proxy requests route through the requesting tenant's providers and chains loaded from Postgres
  4. Request logs written during a proxy call appear only in the requesting tenant's usage history
**Plans**: TBD

### Phase 12: Hono Auth Middleware and SaaS Route Wiring
**Goal**: All protected API routes in SaaS mode require a valid Supabase JWT; the proxy endpoint resolves tenant context from a per-tenant API key
**Depends on**: Phase 11
**Requirements**: AUTH-06, AUTH-07, DATA-04
**Success Criteria** (what must be TRUE):
  1. An API request with no Authorization header to a protected route returns 401 in SaaS mode and passes through in self-hosted mode unchanged
  2. An API request with an expired or tampered JWT returns 401
  3. A valid JWT sets the tenant context so all downstream repository calls operate on that user's data
  4. Sending a chat completion request with a per-tenant proxy API key routes the request through that tenant's configured chains
  5. A new user account has a proxy API key generated and stored automatically at account creation
**Plans**: TBD

### Phase 13: Frontend Auth Layer
**Goal**: Users can sign up, verify email, log in, and access tenant-scoped views; unauthenticated users are redirected to login; self-hosted mode shows no auth UI
**Depends on**: Phase 12
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, UI-01, UI-02, UI-03, UI-04, UI-05
**Success Criteria** (what must be TRUE):
  1. A new user can submit the signup form and immediately see a "check your email" confirmation screen
  2. After clicking the verification link, the user lands on the app fully logged in without re-entering credentials
  3. Navigating directly to any app route while logged out redirects to the login page
  4. After login, the provider list, chain list, dashboard, and test page show only that user's data
  5. Clicking logout clears the session and redirects to the login page; the app API key input from self-hosted mode is gone
  6. Running in self-hosted mode shows no login or signup UI; the app loads directly as it did before
**Plans**: TBD

### Phase 14: End-to-End Integration and Deployment Config
**Goal**: Both modes are validated end-to-end; operators have everything needed to deploy 429chain as a SaaS using a single Docker image and environment variables
**Depends on**: Phase 13
**Requirements**: DEPLOY-01, DEPLOY-02, DEPLOY-03
**Success Criteria** (what must be TRUE):
  1. docker compose up with self-hosted env vars starts the proxy serving the self-hosted UI with no Supabase connection
  2. docker compose up with SaaS env vars starts the proxy requiring login before any data is accessible
  3. Two concurrent users making requests to the proxy receive only their own providers, chains, and logs — no cross-tenant data leaks under concurrent load
  4. A new operator can find all required environment variables for both modes in one documentation file
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 9 → 10 → 11 → 12 → 13 → 14

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Core Waterfall Proxy | v1.0 | 4/4 | Complete | 2026-02-05 |
| 2. SSE Streaming | v1.0 | 2/2 | Complete | 2026-02-05 |
| 3. Rate Limit Intelligence | v1.0 | 4/4 | Complete | 2026-02-05 |
| 4. Observability & Persistence | v1.0 | 3/3 | Complete | 2026-02-05 |
| 5. Web UI | v1.0 | 6/6 | Complete | 2026-02-06 |
| 6. Docker Deployment | v1.0 | 3/3 | Complete | 2026-02-06 |
| 7. CLI Support | v1.0 | 3/3 | Complete | 2026-02-06 |
| 8. Queue Mode | — | 3/3 | Complete | 2026-02-27 |
| 9. Dual-Mode Repository Abstraction | 2/2 | Complete   | 2026-02-28 | - |
| 10. Postgres Schema and RLS | v1.1 | 0/? | Not started | - |
| 11. Supabase Repository Implementations | v1.1 | 0/? | Not started | - |
| 12. Hono Auth Middleware and SaaS Route Wiring | v1.1 | 0/? | Not started | - |
| 13. Frontend Auth Layer | v1.1 | 0/? | Not started | - |
| 14. End-to-End Integration and Deployment Config | v1.1 | 0/? | Not started | - |

---
*Roadmap created: 2026-02-05*
*Last updated: 2026-03-01 after Phase 9 planning complete (2 plans)*
