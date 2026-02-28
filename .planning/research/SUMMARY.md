# Project Research Summary

**Project:** 429chain v1.1 SaaS Multi-Tenancy
**Domain:** AI inference proxy — adding Supabase Auth + Postgres multi-tenancy to an existing single-user self-hosted proxy
**Researched:** 2026-03-01
**Confidence:** HIGH

## Executive Summary

429chain v1.1 adds a SaaS multi-tenant mode to an existing, fully-shipped single-user proxy. The architecture centers on one core constraint: self-hosted mode must remain completely unchanged and zero-dependency on Supabase. This is enforced through a repository pattern abstraction that separates storage backends behind a common interface, selected at startup via a `MODE=saas` env var. Every Supabase-specific module must be isolated behind dynamic imports and only loaded in SaaS mode — unconditional Supabase imports anywhere in shared code will break self-hosted deployments silently.

The SaaS data layer uses Supabase Auth for user management (email/password, JWT issuance) and Supabase Postgres with Row Level Security for tenant data isolation. The critical implementation discipline is dual-client usage: a per-request user-scoped Supabase client (initialized with the user's JWT) for all tenant-data queries so RLS enforces isolation automatically, and a service-role client restricted exclusively to explicit admin operations like user provisioning. Using the service-role client in route handlers silently bypasses all RLS and exposes every tenant's data — this is the highest-severity pitfall and must be enforced structurally.

The key risks are (1) RLS misconfiguration enabling cross-tenant data leakage, particularly missing `WITH CHECK` clauses on INSERT/UPDATE policies and un-tenant-scoped unique constraints; (2) connection pooler session variable leakage when using `SET` instead of `SET LOCAL` for JWT claim context; (3) the SaaS chat path requiring per-request DB queries to load each tenant's providers and chains (no shared startup-loaded Maps), which is a significant architectural change to the hot path. The recommended mitigation is to build the repository abstraction first, validate both backends in CI with a matrix job, and write cross-tenant isolation tests before any feature work.

## Key Findings

### Recommended Stack

The v1.1 additions are minimal: three new backend packages (`@supabase/supabase-js`, `postgres`, `jose`) and one frontend package (`@supabase/supabase-js`). The entire existing stack (Hono, better-sqlite3, React 19, Vite, tsdown, zod, pino, nanoid, vitest) is unchanged. No ORM is needed — the repository pattern uses raw SQL with typed interfaces on each backend.

The critical version constraint is `jose` v6, which is ESM-only and required for JWKS-based JWT verification. Supabase projects created after May 2025 use asymmetric RSA keys by default; Hono's built-in JWT middleware only handles static secrets and cannot verify asymmetric keys. `jose` with `createRemoteJWKSet()` is the correct choice. The Postgres driver is `postgres` (postgres.js v3), not `pg` — it is ESM-native, Supabase-recommended, and uses a tagged-template API. The session pooler URL (not transaction mode) is required for the long-running Docker container deployment.

**Core technologies:**
- `@supabase/supabase-js` ^2.98.0: Auth client (browser) + PostgREST client (server); `@supabase/ssr` explicitly NOT needed for a Vite SPA
- `postgres` ^3.4.8: Direct Postgres driver — ESM-native, Supabase-recommended for long-running containers; session pooler URL required
- `jose` ^6.1.3: JWT verification with JWKS endpoint support — handles Supabase's asymmetric keys; replaces Hono's built-in JWT middleware

**What NOT to add:**
- `@supabase/ssr` — designed for SSR frameworks (Next.js, Remix); this is a Vite SPA
- `drizzle-orm` / `prisma` — ORM abstraction conflicts with dual-mode repository pattern; use raw SQL
- `jsonwebtoken` — CommonJS-only, no JWKS support; replaced by `jose`
- `pg` (node-postgres) — older, CJS-first; replaced by `postgres`

### Expected Features

The v1.1 MVP must preserve self-hosted mode as a first-class deployment option while adding a parallel SaaS path. All table-stakes features revolve around the auth/tenant stack. Billing, team accounts, OAuth, and admin dashboards are explicitly deferred.

**Must have (table stakes):**
- `APP_MODE` env var dual-path initialization — gates Supabase; preserves self-hosted path unchanged
- Repository pattern abstraction (SQLite and Postgres implementations behind one interface) — required before any other v1.1 feature; highest-risk dependency
- Supabase Auth: email/password signup with email verification
- Persistent JWT sessions with refresh (Supabase session management, localStorage for SPA)
- Protected React routes via `ProtectedRoute` component and `AuthContext`
- Postgres schema with RLS on all tenant tables (`providers`, `chains`, `chain_entries`, `request_logs`)
- Per-tenant proxy API key (generated on account creation, resolves tenant context on proxy requests)
- BYOK provider keys per tenant (stored in Postgres with `user_id`, isolated by RLS)
- Login and signup pages, logout
- Cloud deployment env var documentation

**Should have (competitive differentiators):**
- Zero-friction onboarding: signup to first proxied request under 5 minutes
- Per-tenant usage isolation in dashboard (tenant-scoped existing v1.0 dashboard — no rewrites)
- Single Docker image, env-var-driven mode selection — no code forks, no separate images
- Instant migration path for self-hosted users (same proxy API; change only `baseURL`)

**Defer (v2+):**
- Team/org accounts with RBAC (doubles scope; doubles auth surface)
- OAuth / social login (Supabase supports it; add when email/password proves friction)
- Billing integration (own milestone; premature billing creates technical debt)
- Customer-managed encryption keys (enterprise-grade; v3+ only)
- SSO / SAML, Admin user management dashboard

**Feature dependency note:** Auth must come before tenant data isolation. The database abstraction layer is the highest-risk dependency — everything else depends on it. v1.0 UI components are extended, not rewritten.

### Architecture Approach

The architecture is an extension, not a rewrite. The existing Hono server, React SPA, and self-hosted SQLite path are preserved intact. New SaaS-specific code is added in two areas: (1) a `src/persistence/repositories/` directory containing interface definitions, factory, and two concrete implementations; (2) a frontend auth layer (`AuthContext`, `Login`, `Signup`, `ProtectedRoute`) that wraps existing pages without modifying them. The route factories (`createAdminRoutes`, `createStatsRoutes`) are updated to accept repository interfaces instead of raw dependencies.

**Major components:**
1. `repositoryFactory` — reads `MODE` env var at startup, returns `{admin, stats}` repository pair; single decision point for all backend selection
2. `createSupabaseAuthMiddleware` — validates user JWT via `supabase.auth.getUser()`, sets `c.var.userId`; replaces API key check in SaaS mode only; existing `createAuthMiddleware` unchanged for self-hosted
3. `SupabaseAdminRepository` / `SupabaseStatsRepository` — Postgres implementations using service-role client for writes (explicit `user_id`), user-scoped client for reads (RLS enforces isolation automatically)
4. `SQLiteAdminRepository` / `SQLiteStatsRepository` — thin wrappers around existing config/YAML/registry logic; `userId` parameter accepted but ignored; self-hosted behavior 100% preserved
5. `AuthContext` (React) — session state via `onAuthStateChange`; provides `userId` and `signOut`; reads from localStorage (no network) for route gating

**Suggested build order (from ARCHITECTURE.md):**
1. Repository interfaces + SQLite wrappers (no auth needed, testable with hardcoded userId)
2. Postgres schema + RLS policies (schema must exist before Supabase repos can be written)
3. Supabase repository implementations
4. Hono Supabase auth middleware + route wiring
5. Route factory updates to accept repository interfaces; SaaS chat path redesign
6. Frontend auth layer
7. End-to-end integration + cross-tenant isolation tests

### Critical Pitfalls

The PITFALLS.md covers both v1.0 pitfalls (relevant to the existing proxy) and v1.1 SaaS-specific pitfalls. Top pitfalls for v1.1:

1. **Unconditional Supabase imports in shared modules** — Any top-level ESM `import` from `@supabase/supabase-js` in a module loaded by self-hosted mode causes startup failure. All Supabase code must live exclusively in `src/persistence/repositories/supabase/`; use dynamic `import()` at the factory level; CI matrix job for `MODE=self-hosted` with no Supabase env vars is mandatory.

2. **Global service_role client in route handlers** — Bypasses all RLS silently; exposes all tenants' data. Structural rule: service_role client only in explicitly named admin functions; all route-handler DB access uses per-request user-scoped client via `c.var`; cross-tenant isolation test is mandatory.

3. **RLS policies missing `WITH CHECK` on INSERT/UPDATE** — `USING` alone filters reads; without `WITH CHECK`, tenants can inject data into other tenants' namespaces. Every INSERT/UPDATE policy must include `WITH CHECK (auth.uid() = user_id)`; run Supabase Security Advisor after every schema change.

4. **Session variable leakage with Supavisor connection pooler** — `SET` (session-level) for JWT claims persists across pooled connections; under concurrent load, tenant A's context leaks to tenant B's request. Always use `SET LOCAL` inside an explicit transaction; concurrent cross-tenant test required.

5. **In-memory Maps cannot serve SaaS mode** — The startup-loaded `registry` and `chains` Maps are single-user. SaaS mode requires per-request DB queries to load each tenant's providers and chains. The chat route must be redesigned for SaaS (load from Postgres per-request; per-userId LRU cache). This is the primary architectural complexity of the SaaS hot path.

6. **`getUser()` in SSE streaming loop** — The Supabase `getUser()` call makes a network round-trip; placing it inside the streaming loop adds 50-200ms latency per chunk. Validate JWT once at stream establishment; store `userId` in request context closure; all mid-stream DB writes use stored `userId`.

7. **BYOK provider API keys stored as plaintext** — A single RLS misconfiguration exposes all tenants' provider credentials. Encrypt at the application layer before writing to Postgres (Supabase Vault or AES-256-GCM with server-side `ENCRYPTION_KEY` env var).

8. **Unique constraints without tenant scope** — A global `UNIQUE(name)` leaks data existence across tenants (duplicate key error reveals another tenant has a resource with that name). Every uniqueness constraint must include `user_id`: `UNIQUE(user_id, name)`.

## Implications for Roadmap

Based on the dependency chain from FEATURES.md and the build order from ARCHITECTURE.md, the natural phase structure is:

### Phase 1: Dual-Mode Repository Abstraction

**Rationale:** Everything else depends on this. The interface must be defined before either implementation is written. This phase has no auth dependency and is fully testable with hardcoded user IDs. It also locks in the structural rule that prevents Supabase imports from leaking into shared code. Self-hosted mode is validated here before any Supabase code exists.

**Delivers:** `IAdminRepository`, `IStatsRepository` interfaces; `SQLiteAdminRepository` and `SQLiteStatsRepository` wrappers (extracting existing route handler logic); `repositoryFactory` with `MODE` env var selection; updated `createAdminRoutes` and `createStatsRoutes` accepting repository interfaces; self-hosted mode working identically to today via new code path.

**Addresses:** APP_MODE env var gating (P1); database abstraction layer (P1)

**Avoids:** Supabase import leakage (SaaS Pitfall 1); DB abstraction interface leak (SaaS Pitfall 7)

**Research flag:** Standard patterns — no research-phase needed. Repository pattern and factory approach are explicit in ARCHITECTURE.md.

### Phase 2: Postgres Schema and RLS

**Rationale:** The Supabase repository implementations cannot be written without a schema. Schema design is where the hardest security decisions live (RLS policy completeness, unique constraint scoping, encryption strategy). These are expensive to fix post-data.

**Delivers:** `migrations.sql` with `providers`, `chains`, `chain_entries`, `request_logs` tables; RLS policies with `USING + WITH CHECK + TO authenticated` on all tables; tenant-scoped composite primary keys and uniqueness constraints (`UNIQUE(user_id, name)`); indexes on `(user_id, ...)` for RLS query performance; decision on provider API key encryption (Supabase Vault vs AES-256-GCM).

**Addresses:** Postgres schema + RLS (P1); BYOK provider keys per tenant (P1)

**Avoids:** Missing `WITH CHECK` (SaaS Pitfall 3); tenant-scoped unique constraints (SaaS Pitfall 8); plaintext API key storage (SaaS Pitfall 7); `auth.uid()` null silent failure (SaaS Pitfall 3)

**Research flag:** Needs targeted review — run Supabase Security Advisor against schema once migrations are written; confirm encryption approach before any keys are stored.

### Phase 3: Supabase Repository Implementations

**Rationale:** Pure server logic, no Hono or React involved. Testable in isolation with direct Supabase client calls. Depends on Phase 2 (schema) and Phase 1 (interface definitions).

**Delivers:** `supabase/client.ts` (service-role singleton + per-request user client factory); `SupabaseAdminRepository`; `SupabaseStatsRepository`; SaaS path wired into `repositoryFactory`; cross-tenant isolation test (user A cannot see user B's data).

**Uses:** `@supabase/supabase-js` ^2.98.0, `postgres` ^3.4.8 — both new stack additions

**Avoids:** Global service_role client in route handlers (SaaS Pitfall 2); `SET` vs `SET LOCAL` leakage (SaaS Pitfall 4)

**Research flag:** Standard patterns — Supabase JS SDK client patterns are fully covered by official docs.

### Phase 4: Hono Auth Middleware + Route Wiring + SaaS Chat Path

**Rationale:** Depends on Phase 3 (repos must exist to receive `userId`). Also addresses the SaaS chat path redesign — the most complex single task in v1.1, because the existing startup-loaded Maps cannot serve multiple tenants.

**Delivers:** `createSupabaseAuthMiddleware` with `jose` JWKS JWT verification; `c.var.userId` typed context variable threading through all admin and stats routes; SaaS chat path redesigned to load per-tenant providers/chains from Postgres per-request (with per-userId LRU cache, 60-second TTL); self-hosted mode confirmed unchanged.

**Uses:** `jose` ^6.1.3 — JWKS-based JWT verification; replaces Hono's built-in JWT middleware

**Avoids:** `getUser()` in SSE streaming loop (SaaS Pitfall 6); in-memory Maps as SaaS source of truth (ARCHITECTURE.md Anti-Pattern 3)

**Research flag:** The SaaS chat path per-request loading and LRU cache design is a non-trivial architectural change. This phase warrants a focused implementation plan specifying cache key design, TTL, and invalidation triggers (on provider upsert/delete).

### Phase 5: Frontend Auth Layer

**Rationale:** Blocked on Phase 4 — needs a working authenticated API. New files only (except `api.ts`, `Layout.tsx`, `main.tsx` modifications); existing pages are unwrapped.

**Delivers:** `ui/src/lib/supabase.ts` (browser Supabase client singleton); `AuthContext.tsx` with `onAuthStateChange`; `Login.tsx` and `Signup.tsx` pages with error states and post-signup "check your email" UI; `ProtectedRoute.tsx`; updated `api.ts` sending `session.access_token` as Bearer; updated `Layout.tsx` replacing API key input with auth status + logout; updated `main.tsx` adding `AuthProvider`, `/login`/`/signup` routes, `ProtectedRoute` on all app routes.

**Addresses:** Login/signup UI (P1); protected routes (P1); logout (P1); persistent sessions (P1); email verification UX (P1)

**Avoids:** `getSession()` on server-side (ARCHITECTURE.md Anti-Pattern 2); service_role key in frontend bundle (ARCHITECTURE.md Anti-Pattern 1)

**Research flag:** Standard patterns — React Supabase auth with `onAuthStateChange` is the canonical documented pattern; no research needed.

### Phase 6: End-to-End Integration and Deployment Config

**Rationale:** Final integration gate before shipping. Validates both modes work correctly in isolation and together. Produces deployment documentation operators need.

**Delivers:** Self-hosted smoke test (all existing routes, API key auth); SaaS smoke test (two-user cross-tenant isolation test with concurrent requests); chat completions logging to correct tenant's `request_logs`; Docker Compose updated for SaaS mode with env var documentation; cloud deployment runbook.

**Addresses:** Self-hosted mode unchanged (P1); cloud deployment config (P1)

**Avoids:** "Looks Done But Isn't" checklist items from PITFALLS.md SaaS section

**Research flag:** Standard patterns — integration testing and documentation; no research needed.

### Phase Ordering Rationale

- Phases 1-3 are pure backend with no auth dependency — all testable with hardcoded data; this validates the most complex and risky work before user-facing pieces are built
- Phase 4 (auth middleware) is blocked on Phase 3 — repos must exist to receive `userId` from middleware
- Phase 5 (frontend) is blocked on Phase 4 — needs working authenticated API endpoints to call
- Phase 6 (integration) is blocked on all prior phases but adds no new features — it is the validation gate
- Self-hosted mode is validated after Phase 1 (before any Supabase code exists), after Phase 4 (auth wiring), and in Phase 6 — three explicit checkpoints prevent regression

### Research Flags

Phases needing deeper per-plan research during planning:
- **Phase 2:** RLS policy correctness for this specific schema — run Security Advisor; confirm encryption strategy before writing migration
- **Phase 4:** SaaS chat path redesign — per-request tenant resolution and LRU cache implementation are non-trivial changes to the proxy hot path; needs a dedicated implementation plan

Phases with standard patterns (skip research-phase):
- **Phase 1:** Repository pattern + factory — build order explicit in ARCHITECTURE.md
- **Phase 3:** Supabase client patterns — fully covered by official Supabase docs
- **Phase 5:** React AuthContext + Supabase — canonical documented pattern
- **Phase 6:** Integration testing and deployment docs — no novel patterns

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions verified against npm registry March 2026; official Supabase docs confirm every recommendation; `@supabase/ssr` exclusion explicitly confirmed |
| Features | HIGH | Official Supabase Auth and RLS docs; competitor analysis verified via live WebFetch; feature dependency graph matches official patterns |
| Architecture | HIGH | Core patterns verified against official Supabase + Hono docs; build order validated against dependency graph; anti-patterns from official Supabase security guidance |
| Pitfalls (v1.1 SaaS) | HIGH | Critical and security pitfalls verified against official Supabase RLS docs, Bytebase RLS footguns article, Supavisor/pgbouncer docs, AWS multi-tenant RLS guide |
| Pitfalls (v1.0 original) | MEDIUM | Based on training data (cutoff May 2025); web verification was unavailable at time of original research (2026-02-05); patterns are established but provider-specific details should be revalidated |

**Overall confidence:** HIGH

### Gaps to Address

- **SaaS chat path LRU cache design:** The architecture identifies per-request provider/chain loading as a requirement but stops short of a full implementation plan. Phase 4 plan must specify: cache key design, TTL, max size, invalidation on provider upsert/delete, and cold-start behavior.
- **Provider API key encryption approach:** Research identifies Supabase Vault and AES-256-GCM as two valid options. Phase 2 plan must commit to one. Supabase Vault is simpler operationally but couples to Supabase; AES-256-GCM is portable and works independently of Supabase availability.
- **`getClaims()` vs `getUser()` per-request:** ARCHITECTURE.md recommends `getUser()` initially (more secure, network call) with a note to switch to `getClaims()` (local, no network) if latency is a concern. Phase 4 plan should decide which to ship given the proxy's latency sensitivity.
- **Email confirmation UX:** FEATURES.md notes email verification is Supabase default; PITFALLS.md SaaS UX section warns that a missing "check your email" state causes users to think the product is broken. Phase 5 must explicitly handle post-signup state.
- **Concurrent cross-tenant test:** Both ARCHITECTURE.md and PITFALLS.md require this test but neither specifies the implementation. Phase 6 plan should specify this as a concrete deliverable with the exact test structure (two users, concurrent inserts, verify no cross-tenant reads).
- **Current provider rate limit header formats:** v1.0 PITFALLS.md flags OpenRouter, Groq, Cerebras headers as MEDIUM confidence with training data cutoff May 2025. Validate current formats before implementing Phase 3 provider-specific parsing.

## Sources

### Primary (HIGH confidence)
- [Supabase RLS Official Docs](https://supabase.com/docs/guides/database/postgres/row-level-security) — auth.uid(), service role, WITH CHECK, performance
- [Supabase Auth: Password-based Auth](https://supabase.com/docs/guides/auth/passwords) — signup, signIn, session management
- [Supabase: Connect to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres) — session pooler requirement for long-running servers
- [Supabase: Use with Hono](https://supabase.com/docs/guides/getting-started/quickstarts/hono) — official Hono integration patterns
- [Supabase: JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys) — asymmetric keys default post-May 2025
- [Supabase RLS Performance and Best Practices](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv) — index requirements, LEAKPROOF functions
- [jose npm](https://www.npmjs.com/package/jose) — v6.1.3 verified, ESM-only, JWKS support
- [@supabase/supabase-js npm](https://www.npmjs.com/package/@supabase/supabase-js) — v2.98.0 verified March 2026
- [postgres npm](https://www.npmjs.com/package/postgres) — v3.4.8 verified March 2026
- [Hono Context API](https://hono.dev/docs/api/context) — typed context variables

### Secondary (MEDIUM confidence)
- [Common Postgres RLS Footguns — Bytebase](https://www.bytebase.com/blog/postgres-row-level-security-footguns/) — 16 concrete RLS footguns including WITH CHECK, SECURITY DEFINER, unique constraint leakage
- [Multi-tenant data isolation with PostgreSQL RLS — AWS](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/) — connection pooling and SET LOCAL patterns
- [Top LLM Gateways 2025 — Helicone blog](https://www.helicone.ai/blog/top-llm-gateways-comparison-2025) — competitor feature comparison (verified via WebFetch)
- [Multi-Tenant Applications with RLS on Supabase — AntStack](https://www.antstack.com/blog/multi-tenant-applications-with-rls-on-supabase-postgress/) — practical implementation patterns
- LiteLLM project architecture and GitHub issues — proxy architecture patterns, SSE streaming pitfalls
- OpenAI API specification and SDK behavior — OpenAI-compatible contract requirements

### Tertiary (LOW confidence — validate before relying on)
- Current provider rate limit header formats (OpenRouter, Groq, Cerebras) — from v1.0 research; based on training data May 2025; must be revalidated against current provider documentation before implementing provider-specific parsing

---
*Research completed: 2026-03-01*
*Ready for roadmap: yes*
