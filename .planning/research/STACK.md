# Stack Research

**Domain:** AI inference proxy/aggregator — v1.1 SaaS additions
**Researched:** 2026-03-01
**Confidence:** HIGH (versions verified against npm registry and official docs, March 2026)

---

## Scope Note

This file covers the **new additions for v1.1 SaaS multi-tenant mode only**. The existing validated stack (Hono, better-sqlite3, React 19, Vite 7, tsdown, zod, pino, nanoid, ms, vitest) is unchanged and is documented separately below for reference.

The v1.1 additions solve:
1. Supabase Auth (email/password, JWT issuance)
2. Supabase Postgres as the SaaS data layer with RLS-enforced multi-tenancy
3. A dual-mode database abstraction (repository pattern) that works with both SQLite and Postgres
4. Cloud-ready deployment (env-driven mode selection)
5. React frontend auth flows (login/signup, protected routes, session state)

---

## New Additions for v1.1

### Backend — New Production Dependencies

| Package | Version | Purpose | Why |
|---------|---------|---------|-----|
| `@supabase/supabase-js` | ^2.98.0 | Supabase Auth client + PostgREST client | The canonical JS SDK for Supabase. Provides `supabase.auth.signUp()`, `supabase.auth.signInWithPassword()`, session management, and the PostgREST client for data queries. Required in SaaS mode for auth operations. Use with `service_role` key server-side to bypass RLS for admin operations (user creation, seeding). Use with `anon` key + user JWT to enforce RLS for tenant-scoped queries. |
| `postgres` | ^3.4.8 | Direct Postgres driver (postgres.js) | Supabase-recommended driver for Node.js persistent servers. Template-literal query syntax, ESM-native, no dependencies. Used for the Postgres path of the repository pattern. Session pooler mode is correct for a long-running Docker container (not serverless). Transaction mode is NOT correct here — it does not support `set_config` calls needed to pass `auth.uid` to RLS policies. |
| `jose` | ^6.1.3 | JWT verification middleware | Verifies Supabase-issued JWTs in Hono middleware. ESM-only, no dependencies, supports `createRemoteJWKSet()` for asymmetric key verification against Supabase's JWKS endpoint. Supabase projects created after May 2025 use RSA asymmetric keys by default — `jose` handles this correctly. Do NOT use Hono's built-in JWT middleware; it lacks JWKS/remote key fetching support. |

### Frontend — New Production Dependencies

| Package | Version | Purpose | Why |
|---------|---------|---------|-----|
| `@supabase/supabase-js` | ^2.98.0 | Auth client for React UI | Same package, different usage mode. Browser client uses `anon` key, manages session in `localStorage` automatically, provides `onAuthStateChange` listener. No `@supabase/ssr` needed — this is a Vite SPA, not a server-rendered framework. `@supabase/ssr` is for Next.js / Remix / cookie-based session flows. |

### No New Dev Dependencies

The existing dev stack (tsx, tsdown, vitest, TypeScript 5.x) covers all testing and build needs for the new code.

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@supabase/ssr` | Designed for cookie-based SSR frameworks (Next.js, Remix). This project has a Vite SPA frontend and a separate Hono backend — not a unified SSR framework. Using `@supabase/ssr` would add complexity for no benefit. The browser client from `@supabase/supabase-js` directly handles localStorage session for a SPA. | `@supabase/supabase-js` directly |
| `@supabase/auth-helpers-*` | Deprecated. All auth-helpers packages have been consolidated into `@supabase/ssr`, which is also not needed here. | `@supabase/supabase-js` directly |
| `drizzle-orm` / `prisma` / TypeORM | ORMs add abstraction cost and fight against the dual-mode repository pattern. The repository pattern is cleanest with direct drivers on each side: `better-sqlite3` for SQLite, `postgres` (postgres.js) for Postgres. Each repository implementation writes SQL natively to its driver. No ORM needed. | Raw SQL with typed interfaces |
| `jsonwebtoken` | CommonJS-only, does not support JWKS or asymmetric keys well. `jose` is the correct ESM-native replacement for JWT verification in 2026. | `jose` |
| `pg` (node-postgres) | Older, heavier driver. `postgres` (postgres.js) is Supabase's recommended driver for Node.js, has better ESM support, and a cleaner tagged-template query API. | `postgres` |
| Supabase CLI as a runtime dep | The Supabase CLI is for local development / migration management only, never a production runtime dependency. | Keep in local dev workflow only |

---

## Integration Patterns

### Pattern 1: Dual-Mode Repository

The core architectural move for v1.1 is extracting the persistence layer into a repository interface with two concrete implementations.

```typescript
// Repository interface — same contract for both modes
interface ProviderRepository {
  findAll(userId: string): Promise<Provider[]>
  findById(id: string, userId: string): Promise<Provider | null>
  create(data: CreateProviderInput, userId: string): Promise<Provider>
  update(id: string, data: UpdateProviderInput, userId: string): Promise<Provider>
  delete(id: string, userId: string): Promise<void>
}

// SQLite implementation (self-hosted mode)
class SqliteProviderRepository implements ProviderRepository {
  constructor(private db: Database.Database) {}
  findAll(userId: string) {
    // userId is ignored in single-user SQLite mode
    return this.db.prepare('SELECT * FROM providers').all()
  }
  // ...
}

// Postgres implementation (SaaS mode)
class PostgresProviderRepository implements ProviderRepository {
  constructor(private sql: postgres.Sql) {}
  async findAll(userId: string) {
    // RLS on the Postgres side enforces isolation automatically
    // when the connection has auth.uid() set to the user's JWT sub
    return await this.sql`SELECT * FROM providers`
  }
  // ...
}
```

Mode selection is env-driven at startup: `MODE=saas` loads Postgres repositories, anything else (default) loads SQLite repositories.

### Pattern 2: Hono Auth Middleware (SaaS Mode)

```typescript
import { createRemoteJWKSet, jwtVerify } from 'jose'

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.SUPABASE_URL}/rest/v1/jwks`)
)

export const supabaseAuthMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const token = authHeader.slice(7)
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: process.env.SUPABASE_URL + '/auth/v1',
  })
  c.set('userId', payload.sub as string)
  await next()
})
```

This replaces the existing single-user API key check in SaaS mode. In self-hosted mode, the original API key middleware continues to be used unchanged.

### Pattern 3: Postgres RLS Wiring

When querying Postgres as a specific user, the connection must set `auth.uid()` so RLS policies can reference it:

```typescript
// Wrap tenant queries in a transaction that sets the user context
async function withUserContext<T>(
  sql: postgres.Sql,
  userId: string,
  fn: (sql: postgres.TransactionSql) => Promise<T>
): Promise<T> {
  return sql.begin(async (tx) => {
    // Set auth.uid for this transaction — RLS policies read this
    await tx`SELECT set_config('request.jwt.claim.sub', ${userId}, true)`
    await tx`SET LOCAL ROLE authenticated`
    return fn(tx)
  })
}
```

RLS policies on each table use `auth.uid()` / `(current_setting('request.jwt.claim.sub'))::uuid` to scope rows to the current user. The `service_role` Supabase client (used for admin operations) bypasses RLS entirely.

### Pattern 4: Frontend Auth Flow (React SPA)

```typescript
// Single browser-mode Supabase client for the SPA
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

// Auth context wraps the app — provides session to all components
// Uses supabase.auth.onAuthStateChange to react to login/logout/token refresh

// Protected route pattern (React Router v7 — already in use)
// Use a ProtectedRoute wrapper component that reads auth context
// Redirect unauthenticated users to /login via <Navigate>
// No new router library needed — react-router v7 is already installed
```

---

## Environment Variables Required for SaaS Mode

```bash
# Mode selector — default: self-hosted
MODE=saas   # or omit for self-hosted

# Supabase (SaaS mode only)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...           # Public, safe for browser
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # Secret — server only, bypasses RLS
DATABASE_URL=postgres://postgres.xxx:password@aws-0-region.pooler.supabase.com:5432/postgres
# Use SESSION pooler URL (not transaction) for long-running container

# Frontend (Vite env vars — safe to expose)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

---

## Installation

```bash
# Backend additions (SaaS mode)
npm install @supabase/supabase-js postgres jose

# Frontend additions (UI)
cd ui && npm install @supabase/supabase-js
```

That is 3 new backend packages and 1 new frontend package. No dev dependencies added.

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Postgres driver | `postgres` (postgres.js) | `pg` (node-postgres) | `pg` is older, CJS-first, heavier API. postgres.js is ESM-native, Supabase-recommended, simpler tagged-template API. |
| JWT verification | `jose` | Hono built-in JWT middleware | Hono's JWT middleware uses a static secret — it cannot fetch a JWKS endpoint. Supabase's asymmetric keys require JWKS. |
| Auth platform | Supabase Auth | Auth0, Clerk, custom | Project constraint: Supabase was chosen. Supabase Auth + Postgres is a single platform vs. adding a separate auth vendor. |
| Frontend session | `@supabase/supabase-js` browser client | `@supabase/ssr` | `@supabase/ssr` is for SSR frameworks managing sessions via cookies. A Vite SPA stores the session in localStorage — the plain `@supabase/supabase-js` browser client handles this natively. |
| Database abstraction | Repository pattern (raw SQL) | Drizzle ORM | Drizzle supports both SQLite and Postgres, but its migration system and schema definition layer add coupling that complicates runtime mode switching. The repository pattern with native drivers is simpler and more explicit. |
| Postgres for self-hosted | Postgres option in self-hosted | Keep SQLite only | Self-hosted mode must remain zero-dependency. Adding a Postgres option for self-hosted adds operational complexity. The dual-mode split is SaaS=Postgres / self-hosted=SQLite, not both for both. |

---

## Version Compatibility

| Package | Version | Compatible With | Notes |
|---------|---------|-----------------|-------|
| `@supabase/supabase-js` | ^2.98.0 | Node.js >= 18, ESM | Version 2.x is stable. v3 has not been announced. Safe to pin `^2.x`. |
| `postgres` | ^3.4.8 | Node.js >= 12, ESM | ESM-native since v3. Works with TypeScript ESM (NodeNext). |
| `jose` | ^6.1.3 | Node.js >= 20.19.0 or 22.12.0+ for `require(esm)` | v6 is ESM-only. Project is already ESM (`"type": "module"`). No compatibility issue. |
| `@supabase/supabase-js` (frontend) | ^2.98.0 | React 19, Vite 7 | No known conflicts. |

---

## Existing Validated Stack (Unchanged)

The following are already shipped in v1.0 and require no changes for v1.1:

| Package | Version Pinned | Notes |
|---------|---------------|-------|
| `hono` | ^4.11.7 | No changes — middleware composition handles both auth modes |
| `@hono/node-server` | ^1.19.9 | Unchanged |
| `better-sqlite3` | ^12.6.2 | Unchanged — SQLite path in repository pattern |
| `zod` | ^4.3.6 | Unchanged — validation for all inputs |
| `pino` | ^10.3.0 | Unchanged — structured logging |
| `nanoid` | ^5.1.6 | Unchanged — ID generation |
| `ms` | ^2.1.3 | Unchanged — time parsing |
| `yaml` | ^2.8.2 | Unchanged — config file parsing |
| `react` | ^19.2.4 | Unchanged |
| `react-router` | ^7.13.0 | Unchanged — protected route pattern is standard React Router |
| `@tanstack/react-query` | ^5.90.20 | Unchanged — API state management |
| `react-hook-form` | ^7.71.1 | Unchanged — form handling (login/signup forms use this) |
| `@hookform/resolvers` | ^3.10.0 | Unchanged — zod validation for forms |
| `tsdown` | ^0.20.2 | Unchanged — ESM bundler |
| `vitest` | ^4.0.18 | Unchanged — test runner |
| `typescript` | ^5.9.3 | Unchanged |
| `tsx` | ^4.21.0 | Unchanged — dev execution |

---

## Sources

- [@supabase/supabase-js npm](https://www.npmjs.com/package/@supabase/supabase-js) — version 2.98.0 verified, March 2026
- [Supabase: Connect to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres) — session pooler recommendation for long-running servers
- [Supabase: Postgres.js guide](https://supabase.com/docs/guides/database/postgres-js) — postgres.js as recommended driver
- [Supabase: Auth server-side client](https://supabase.com/docs/guides/auth/server-side/creating-a-client) — @supabase/ssr vs plain supabase-js distinction
- [Supabase: JWT signing keys](https://supabase.com/docs/guides/auth/signing-keys) — asymmetric keys default for projects after May 2025
- [Supabase: Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) — RLS patterns, auth.uid(), set_config
- [Supabase: Use with Hono](https://supabase.com/docs/guides/getting-started/quickstarts/hono) — official Hono integration patterns
- [jose npm](https://www.npmjs.com/package/jose) — version 6.1.3 verified, ESM-only, JWKS support confirmed
- [@supabase/ssr npm](https://www.npmjs.com/package/@supabase/ssr) — version 0.8.0, confirmed SSR-frameworks-only scope
- [postgres npm](https://www.npmjs.com/package/postgres) — version 3.4.8 verified, March 2026
- [Hono JWT middleware docs](https://hono.dev/docs/middleware/builtin/jwt) — confirmed static-secret only, no JWKS support

---
*Stack research for: 429chain v1.1 SaaS additions (Supabase Auth + Postgres + dual-mode DB)*
*Researched: 2026-03-01*
*Confidence: HIGH — versions verified against npm registry, patterns verified against official Supabase docs*
