# Architecture Research

**Domain:** Multi-tenant SaaS integration into existing Hono + React proxy
**Researched:** 2026-03-01
**Confidence:** HIGH (core patterns verified against official Supabase and Hono docs)

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        React 19 + Vite SPA                        │
│                                                                    │
│  ┌──────────────┐  ┌────────────────────┐  ┌───────────────────┐  │
│  │  AuthContext │  │  Authenticated App │  │  Login/Signup UI  │  │
│  │  (session,   │  │  (existing pages:  │  │  (new: Login.tsx, │  │
│  │   userId,    │  │   Dashboard,       │  │   Signup.tsx)     │  │
│  │   supabase   │  │   Providers,       │  └─────────┬─────────┘  │
│  │   client)    │  │   Chains, Test)    │            │            │
│  └──────┬───────┘  └────────────────────┘            │            │
│         │   session.access_token added to             │            │
│         │   all /v1/ API calls                        │ signUp /   │
│         │   (replaces old API key input)              │ signIn     │
└─────────┼───────────────────────────────────────────┬─┼────────────┘
          │ Bearer <jwt>                               │ │
          │                                           │ │
          ▼                                           ▼ ▼
┌──────────────────────────────────────────────────────────────────┐
│                        Hono HTTP Server                           │
│                                                                    │
│  /health  (no auth, unchanged)                                     │
│                                                                    │
│  /v1/*  ─── mode-gated auth:                                       │
│             self-hosted: createAuthMiddleware() (API key, TODAY)   │
│             saas:        createSupabaseAuthMiddleware() (NEW)       │
│             │  verifies JWT via supabase.auth.getUser(token)        │
│             │  sets c.var.userId (string)                           │
│             ▼                                                       │
│         ┌───────────────────────────────────────────────────────┐  │
│         │  Route Handlers (unchanged signatures)                │  │
│         │                                                        │  │
│         │  /admin/*  ──── IAdminRepository (NEW interface)      │  │
│         │  /stats/*  ──── IStatsRepository (NEW interface)      │  │
│         │  /chat/*   ──── unchanged waterfall logic             │  │
│         │                 requestLogger gains userId param       │  │
│         └───────────────────────────────────────────────────────┘  │
│                                                                    │
│  Static SPA fallback (unchanged)                                   │
└──────────────────────────────────────────────────────────────────┘
          │                              │
          ▼                              ▼
┌─────────────────┐         ┌───────────────────────────────────────┐
│  SQLiteAdapter  │         │          SupabaseAdapter               │
│  (self-hosted   │         │  (SaaS mode, MODE=saas env var)        │
│   mode,         │         │                                        │
│   better-sqlite3│         │  service-role client (server writes)   │
│   unchanged)    │         │  user JWT client (RLS-enforced reads)  │
└─────────────────┘         └───────────────────────────────────────┘
          │                              │
          ▼                              ▼
┌─────────────────┐         ┌───────────────────────────────────────┐
│  SQLite file    │         │  Supabase Postgres                     │
│  (WAL mode)     │         │  - providers (user_id FK)              │
│                 │         │  - chains + chain_entries (user_id FK) │
│  Existing       │         │  - request_logs (user_id FK)           │
│  schema         │         │  - usage aggregates (user_id FK)       │
│  unchanged      │         │  + RLS policies on all tables          │
│                 │         │  + Supabase Auth (managed users table) │
└─────────────────┘         └───────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Existing or New |
|-----------|----------------|-----------------|
| `createAuthMiddleware` | API key validation (Bearer token vs config) | **UNCHANGED** (self-hosted only) |
| `createSupabaseAuthMiddleware` | JWT verification via `getUser()`, sets `c.var.userId` | **NEW** (SaaS mode) |
| `IAdminRepository` | Interface for provider/chain CRUD | **NEW** |
| `IStatsRepository` | Interface for request logs and aggregates | **NEW** |
| `SQLiteAdminRepository` | Implements IAdminRepository via configRef + YAML write | **NEW** (wraps existing admin logic) |
| `SQLiteStatsRepository` | Implements IStatsRepository via existing RequestLogger + Aggregator | **NEW** (thin wrapper) |
| `SupabaseAdminRepository` | Implements IAdminRepository via Postgres + RLS | **NEW** |
| `SupabaseStatsRepository` | Implements IStatsRepository via Postgres + RLS | **NEW** |
| `repositoryFactory` | Returns correct adapter pair based on `MODE` env var | **NEW** |
| `supabase/client.ts` | Service-role singleton + per-request user client factory | **NEW** |
| `AuthContext.tsx` | React context holding session, userId, signOut | **NEW** |
| `Login.tsx` / `Signup.tsx` | Email/password auth forms using `supabase.auth` | **NEW** |
| `ProtectedRoute` | Redirects unauthenticated users to `/login` | **NEW** |
| `ui/src/lib/supabase.ts` | Frontend Supabase client singleton | **NEW** |
| `ui/src/lib/api.ts` | Sends `session.access_token` as Bearer token | **MODIFIED** |
| `ui/src/components/Layout.tsx` | Replace API key input with auth status + logout | **MODIFIED** |
| `ui/src/main.tsx` | Add AuthProvider wrapper, /login + /signup routes | **MODIFIED** |
| `src/index.ts` | Mode detection, repository factory, auth middleware selection | **MODIFIED** |
| `createAdminRoutes` | Receives `IAdminRepository` instead of raw configRef/registry | **MODIFIED** |
| `createStatsRoutes` | Receives `IStatsRepository` instead of raw Aggregator | **MODIFIED** |
| All other route factories | Unchanged signatures and logic | **UNCHANGED** |

---

## Recommended Project Structure

New files and folders only. Existing structure is preserved.

```
src/
├── api/
│   └── middleware/
│       ├── auth.ts              # EXISTING: API key middleware (unchanged)
│       └── supabase-auth.ts     # NEW: JWT verification middleware for SaaS mode
│
├── persistence/                 # EXISTING folder
│   ├── db.ts                    # EXISTING: SQLite init (unchanged)
│   ├── schema.ts                # EXISTING: SQLite migrations (unchanged)
│   ├── request-logger.ts        # EXISTING: SQLite request logger (unchanged)
│   ├── aggregator.ts            # EXISTING: SQLite aggregator (unchanged)
│   │
│   └── repositories/            # NEW folder
│       ├── types.ts             # NEW: IAdminRepository, IStatsRepository interfaces
│       ├── factory.ts           # NEW: repositoryFactory() — selects impl by MODE
│       ├── sqlite/
│       │   ├── admin.ts         # NEW: SQLiteAdminRepository (wraps config/registry/YAML)
│       │   └── stats.ts         # NEW: SQLiteStatsRepository (wraps RequestLogger + Aggregator)
│       └── supabase/
│           ├── client.ts        # NEW: service-role singleton + user client factory
│           ├── admin.ts         # NEW: SupabaseAdminRepository
│           ├── stats.ts         # NEW: SupabaseStatsRepository
│           └── migrations.sql   # NEW: Postgres schema + RLS policy definitions
│
ui/src/
├── lib/
│   ├── api.ts                   # MODIFIED: read session.access_token as Bearer
│   ├── supabase.ts              # NEW: createClient(VITE_SUPABASE_URL, VITE_ANON_KEY)
│   └── queryKeys.ts             # EXISTING: unchanged
│
├── contexts/
│   └── AuthContext.tsx          # NEW: session state, onAuthStateChange, Provider + hook
│
├── pages/
│   ├── Login.tsx                # NEW: email/password sign-in form
│   ├── Signup.tsx               # NEW: email/password sign-up form
│   ├── Dashboard.tsx            # EXISTING: unchanged
│   ├── Providers.tsx            # EXISTING: unchanged
│   ├── Chains.tsx               # EXISTING: unchanged
│   └── Test.tsx                 # EXISTING: unchanged
│
├── components/
│   ├── Layout.tsx               # MODIFIED: replace API key input with auth status/logout
│   └── ProtectedRoute.tsx       # NEW: redirect to /login if no session
│
└── main.tsx                     # MODIFIED: AuthProvider wrap, /login + /signup routes,
                                 #           ProtectedRoute on existing app routes
```

---

## Architectural Patterns

### Pattern 1: Mode-Gated Repository Factory

**What:** A single `repositoryFactory()` reads `process.env.MODE` at startup and returns the correct repository implementation pair. Route factories receive repository interfaces and are unaware of which backend is active.

**When to use:** Exactly this dual-backend scenario. Same business logic, two storage backends. The factory is the single decision point.

**Trade-offs:** Simple and explicit. Does not support runtime switching (restart required). Adding a third backend is one new implementation class.

```typescript
// src/persistence/repositories/types.ts
export interface IAdminRepository {
  listProviders(userId: string): Promise<ProviderConfig[]>;
  upsertProvider(userId: string, provider: ProviderConfig): Promise<void>;
  deleteProvider(userId: string, id: string): Promise<void>;
  listChains(userId: string): Promise<ChainConfig[]>;
  upsertChain(userId: string, chain: ChainConfig): Promise<void>;
  deleteChain(userId: string, name: string): Promise<void>;
}

export interface IStatsRepository {
  logRequest(userId: string, entry: RequestLogEntry): Promise<void>;
  getProviderStats(userId: string): Promise<ProviderStat[]>;
  getChainStats(userId: string): Promise<ChainStat[]>;
  getRequests(userId: string, limit: number): Promise<RequestLogEntry[]>;
  getSummary(userId: string): Promise<SummaryStats>;
}

// src/persistence/repositories/factory.ts
export function repositoryFactory(mode: 'sqlite' | 'supabase', deps: FactoryDeps) {
  if (mode === 'supabase') {
    const client = getSupabaseServiceClient(deps.supabaseUrl, deps.supabaseServiceKey);
    return {
      admin: new SupabaseAdminRepository(client),
      stats: new SupabaseStatsRepository(client),
    };
  }
  return {
    admin: new SQLiteAdminRepository(
      deps.configRef, deps.configPath, deps.registry, deps.chains
    ),
    stats: new SQLiteStatsRepository(deps.requestLogger, deps.aggregator),
  };
}
```

### Pattern 2: Hono Typed Context Variables for Tenant Propagation

**What:** The SaaS auth middleware sets `userId` as a typed Hono context variable via `c.set('userId', user.id)`. Route handlers read `c.var.userId` — no prop-drilling, no global state, type-safe.

**When to use:** Anytime middleware needs to pass per-request data downstream to handlers.

**Trade-offs:** Type-safe when `Variables` generic is declared on the Hono app. In self-hosted mode the variable is never set and handlers pass an empty string to repositories (which SQLite implementations ignore). This is intentional.

```typescript
// src/api/middleware/supabase-auth.ts
import { createMiddleware } from 'hono/factory';
import { createClient } from '@supabase/supabase-js';

type AuthEnv = {
  Variables: {
    userId: string;
  };
};

export function createSupabaseAuthMiddleware(supabaseUrl: string, supabaseAnonKey: string) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const authorization = c.req.header('authorization');
    if (!authorization?.startsWith('Bearer ')) {
      return c.json(
        { error: { message: 'Missing authorization', code: 'invalid_api_key' } },
        401,
      );
    }

    const token = authorization.slice('Bearer '.length);

    // getUser() verifies token against Supabase Auth server on every request.
    // More secure than getClaims() for server-side use — cannot be spoofed.
    // Switch to getClaims() later if latency is a concern and project uses
    // asymmetric (RSA/ECC) signing keys (local verification, no network call).
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: { user }, error } = await userClient.auth.getUser();

    if (error || !user) {
      return c.json(
        { error: { message: 'Invalid token', code: 'invalid_api_key' } },
        401,
      );
    }

    c.set('userId', user.id);
    await next();
  });
}
```

### Pattern 3: SQLite Repository Wraps Existing Logic Without Changing It

**What:** `SQLiteAdminRepository` takes `configRef`, `configPath`, `registry`, and `chains` in its constructor — the same deps the route factory receives today. The implementation delegates to the exact same mutations that exist in the route handler now.

**When to use:** This is the migration strategy: extract existing behavior into a named class before abstracting.

**Trade-offs:** Self-hosted behavior is 100% preserved. The "repository" is really a YAML+memory store, not a database. This naming is intentional — it satisfies the interface without inventing a new storage system for self-hosted users.

```typescript
// src/persistence/repositories/sqlite/admin.ts
export class SQLiteAdminRepository implements IAdminRepository {
  constructor(
    private configRef: { current: Config },
    private configPath: string,
    private registry: ProviderRegistry,
    private chains: Map<string, Chain>,
  ) {}

  // userId is ignored — single-user mode, all data belongs to one instance
  async listProviders(_userId: string): Promise<ProviderConfig[]> {
    return Promise.resolve([...this.configRef.current.providers]);
  }

  async upsertProvider(_userId: string, provider: ProviderConfig): Promise<void> {
    const idx = this.configRef.current.providers.findIndex((p) => p.id === provider.id);
    if (idx !== -1) {
      this.configRef.current.providers[idx] = provider;
    } else {
      this.configRef.current.providers.push(provider);
    }
    const adapter = createAdapter(provider);
    this.registry.add(provider.id, adapter);
    writeConfig(this.configPath, this.configRef.current);
    return Promise.resolve();
  }

  // ... deleteProvider, listChains, upsertChain, deleteChain follow same pattern
}
```

### Pattern 4: Supabase Per-Request User Client for RLS

**What:** Two Supabase clients with distinct roles. A service-role client (singleton, bypasses RLS) is used only for writes where the server must set `user_id`. A per-request client initialized with the user's JWT is used for queries — the JWT causes Postgres to evaluate RLS policies automatically via `auth.uid()`.

**When to use:** Standard Supabase server-side pattern for multi-tenant data. The service-role key MUST stay server-side only (non-VITE env var).

**Trade-offs:** Per-request client creation has negligible overhead with `@supabase/supabase-js`. Using the service-role client for queries would silently bypass RLS and expose all users' data — a critical security defect.

```typescript
// src/persistence/repositories/supabase/client.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let serviceClient: SupabaseClient | null = null;

// Singleton — bypasses RLS, server-only operations (e.g., insert with explicit user_id)
export function getSupabaseServiceClient(url: string, serviceKey: string): SupabaseClient {
  if (!serviceClient) {
    serviceClient = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });
  }
  return serviceClient;
}

// Per-request — user JWT triggers RLS policies for all queries
export function createUserScopedClient(url: string, anonKey: string, jwt: string): SupabaseClient {
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
}
```

### Pattern 5: React AuthContext with onAuthStateChange

**What:** A React context holds the Supabase session, exposes `userId` and a `signOut` helper. All components read from this context. Session is persisted to `localStorage` automatically by the Supabase client. The `onAuthStateChange` subscription keeps the context current across tab refreshes and token auto-refresh.

**When to use:** Standard React Supabase integration. Centralizes session logic so no page calls `getSession()` independently.

**Trade-offs:** `getSession()` reads from localStorage without network verification — fine for UI display (gating renders). The actual security enforcement is the Bearer JWT the server verifies. Never use client-side session data to authorize sensitive operations — that happens on the server.

```typescript
// ui/src/contexts/AuthContext.tsx
import { createContext, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase.js';

interface AuthContextValue {
  session: Session | null;
  userId: string | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null, userId: null, loading: true, signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Read cached session from localStorage (no network)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Live updates: login, logout, token refresh
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{
      session,
      userId: session?.user?.id ?? null,
      loading,
      signOut: () => supabase.auth.signOut(),
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
```

---

## Data Flow

### Request Flow — SaaS Mode (Chat Completion)

```
React UI
  │  POST /v1/chat/completions
  │  Authorization: Bearer <supabase_access_token>
  ▼
createSupabaseAuthMiddleware
  │  calls supabase.auth.getUser(token)  [network call to Supabase Auth]
  │  sets c.var.userId = user.id
  ▼
createChatRoutes handler (logic unchanged)
  │  resolves chain from chains Map
  │  executes waterfall through provider adapters
  │  calls statsRepo.logRequest(userId, entry)  ← gains userId param
  ▼
IStatsRepository.logRequest()
  │
  ├─ SQLite: SQLiteStatsRepository → existing RequestLogger (unchanged behavior)
  └─ Supabase: SupabaseStatsRepository → INSERT request_logs (user_id = userId)
               RLS ensures user can only SELECT their own logs
```

### Request Flow — Admin Operation (Upsert Provider, SaaS Mode)

```
React UI
  │  PUT /v1/admin/providers/:id
  │  Authorization: Bearer <supabase_access_token>
  │  Body: { id, type, apiKey, ... }
  ▼
createSupabaseAuthMiddleware → c.var.userId = user.id
  ▼
createAdminRoutes handler (MODIFIED: receives IAdminRepository)
  │  validates body with Zod (unchanged)
  │  calls adminRepo.upsertProvider(userId, providerConfig)
  ▼
SupabaseAdminRepository.upsertProvider()
  │  service-role client: UPSERT providers (id, user_id, type, api_key, ...)
  │  user_id = userId set explicitly at INSERT
  │  RLS WITH CHECK policy prevents writing other users' records
```

### Request Flow — Self-Hosted Mode (any operation)

```
React UI (no AuthContext — Layout shows plain API key input)
  │  PUT /v1/admin/providers/:id
  │  Authorization: Bearer <api_key_from_config>
  ▼
createAuthMiddleware (UNCHANGED) — validates against config.settings.apiKeys
  ▼
createAdminRoutes handler
  │  calls adminRepo.upsertProvider('', providerConfig)  ← userId empty string
  ▼
SQLiteAdminRepository.upsertProvider()
  │  userId ignored — same behavior as today
  │  configRef mutation + YAML write + registry.add()
```

### Frontend Auth State Flow

```
App loads
  ▼
AuthProvider mounts
  │  getSession() → reads localStorage (no network)
  │  setSession(session) → userId available immediately if logged in
  │  onAuthStateChange subscription established
  ▼
Router renders:
  /login, /signup → public (no ProtectedRoute)
  /*, /providers, /chains, /test → wrapped in ProtectedRoute
  ▼
ProtectedRoute
  │  loading == true → render spinner
  │  session == null AND loading == false → redirect to /login
  │  session != null → render children
  ▼
apiFetch() in api.ts
  │  reads session?.access_token from AuthContext (or supabase.auth.getSession())
  │  adds Authorization: Bearer <access_token> to every request
  │  on 401 → existing clearApiKey() call replaced with supabase.auth.signOut()
```

---

## Postgres Schema

### Tables (Supabase mode only)

```sql
-- All tables use auth.uid() in RLS policies.
-- auth.uid() returns the sub claim from the Supabase JWT.
-- (select auth.uid()) syntax caches the result per query — faster.

CREATE TABLE providers (
  id          TEXT     NOT NULL,
  user_id     UUID     NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        TEXT     NOT NULL,
  base_url    TEXT,
  api_key     TEXT     NOT NULL,
  rate_limits JSONB,
  PRIMARY KEY (id, user_id)  -- same provider id can exist per multiple users
);
ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users own their providers"
  ON providers FOR ALL
  USING      ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE TABLE chains (
  name    TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  PRIMARY KEY (name, user_id)
);
ALTER TABLE chains ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users own their chains"
  ON chains FOR ALL
  USING      ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE TABLE chain_entries (
  chain_name  TEXT    NOT NULL,
  user_id     UUID    NOT NULL,
  position    INTEGER NOT NULL,
  provider_id TEXT    NOT NULL,
  model       TEXT    NOT NULL,
  PRIMARY KEY (chain_name, user_id, position),
  FOREIGN KEY (chain_name, user_id) REFERENCES chains(name, user_id) ON DELETE CASCADE
);
ALTER TABLE chain_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users own their chain entries"
  ON chain_entries FOR ALL
  USING      ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE TABLE request_logs (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id           UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  timestamp         BIGINT  NOT NULL,
  chain_name        TEXT    NOT NULL,
  provider_id       TEXT    NOT NULL,
  model             TEXT    NOT NULL,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens      INTEGER NOT NULL DEFAULT 0,
  latency_ms        INTEGER NOT NULL,
  http_status       INTEGER NOT NULL,
  attempts          INTEGER NOT NULL,
  error_message     TEXT
);
ALTER TABLE request_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users see their own logs"
  ON request_logs FOR ALL
  USING      ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Indexes: user_id first in composite index so RLS filter is efficient
CREATE INDEX ON request_logs (user_id, timestamp DESC);
CREATE INDEX ON request_logs (user_id, provider_id);
CREATE INDEX ON request_logs (user_id, chain_name);

-- Note on aggregation tables:
-- The SQLite schema uses materialized aggregation tables (usage_by_provider,
-- usage_by_chain) maintained by INSERT triggers for O(1) stats queries.
-- In Postgres, compute aggregates from request_logs with GROUP BY on first
-- implementation. Materialize later (as a Postgres VIEW or separate table)
-- only if aggregate queries become measurably slow.
```

---

## Integration Points

### New vs Existing Components at Each Layer

| Layer | Unchanged | Modified | New |
|-------|-----------|----------|-----|
| **Bootstrap** | config loading, registry, chains, tracker, queue, SSE | `index.ts`: mode detection, repo factory, auth middleware selection | — |
| **Auth middleware** | `createAuthMiddleware` (self-hosted) | — | `createSupabaseAuthMiddleware` (SaaS) |
| **Route factories** | chat, models, health, ratelimits, test | `createAdminRoutes` (receives IAdminRepository), `createStatsRoutes` (receives IStatsRepository) | — |
| **Persistence interfaces** | db, schema, request-logger, aggregator | — | `IAdminRepository`, `IStatsRepository`, factory |
| **SQLite repos** | db, schema, request-logger, aggregator | — | `SQLiteAdminRepository`, `SQLiteStatsRepository` |
| **Supabase repos** | — | — | `SupabaseAdminRepository`, `SupabaseStatsRepository`, `client.ts`, `migrations.sql` |
| **Frontend** | Dashboard, Providers, Chains, Test pages; TanStack Query setup | `api.ts` (JWT Bearer), `Layout.tsx` (auth UI), `main.tsx` (new routes + AuthProvider) | `supabase.ts`, `AuthContext.tsx`, `Login.tsx`, `Signup.tsx`, `ProtectedRoute.tsx` |

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Supabase Auth | `@supabase/supabase-js` — `signInWithPassword` / `signUp` on frontend; `getUser(token)` on server per-request | `getUser()` makes one network call per API request. Switch to `getClaims()` if project uses asymmetric signing keys for local (no-network) verification. |
| Supabase Postgres | `@supabase/supabase-js` service-role client for server writes; user JWT client for RLS-enforced queries | Service-role key is server-only (non-VITE env var, never in frontend bundle). |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `index.ts` → auth middleware | Mode check at startup; mounts either `createAuthMiddleware` or `createSupabaseAuthMiddleware` on the `v1` sub-app | `MODE=saas` env var is the toggle. Can also infer from `SUPABASE_URL` presence. |
| Route handlers → repositories | Dependency injection via factory function params | `adminRepo.upsertProvider(userId, data)` — same call regardless of backend. |
| Hono auth middleware → route handlers | `c.var.userId` typed context variable | Handlers call `const userId = c.var.userId ?? ''`. SQLite repos ignore empty string. |
| `createAdminRoutes` → `IAdminRepository` | Direct async method calls | `configRef`, `configPath`, `registry`, `chains` move into `SQLiteAdminRepository` constructor — route factory no longer holds these. |
| React `AuthContext` → `api.ts` | `session.access_token` injected as Bearer token | `apiFetch` reads from `supabase.auth.getSession()` or a shared auth context ref. 401 handling redirects to `/login` instead of clearing a simple key. |

---

## Suggested Build Order

Dependencies flow upward. Each step is independently testable before the next starts.

```
Step 1: Repository interfaces + SQLite wrapper classes
  Define IAdminRepository and IStatsRepository in types.ts
  Write SQLiteAdminRepository (extract logic from createAdminRoutes body)
  Write SQLiteStatsRepository (wrap existing RequestLogger + Aggregator)
  Wire into repositoryFactory with mode='sqlite'
  Verify: existing self-hosted behavior unchanged end-to-end
  RATIONALE: No auth needed. Testable with hardcoded userId=''. Unblocks all
             downstream steps since the interface is now defined.

Step 2: Postgres schema
  Write migrations.sql with all tables and RLS policies
  Apply to Supabase project
  Manually verify: two test users cannot read each other's rows
  RATIONALE: Schema must exist before Supabase repository classes can be written.

Step 3: Supabase repository classes
  Write supabase/client.ts (service-role singleton + user client factory)
  Write SupabaseAdminRepository
  Write SupabaseStatsRepository
  Wire into repositoryFactory with mode='supabase'
  Verify: CRUD operations work for a test userId with direct client calls
  RATIONALE: Pure server logic, no Hono or React involved. Testable in isolation.

Step 4: Hono Supabase auth middleware
  Write createSupabaseAuthMiddleware
  Wire into index.ts under MODE=saas gate (else use existing createAuthMiddleware)
  Thread c.var.userId into admin and stats route calls
  Verify: valid JWT passes middleware, invalid JWT returns 401
  RATIONALE: Blocked on Step 3 (needs userId to pass to repos). Steps 2-3 must be done.

Step 5: Route factory updates
  Update createAdminRoutes to accept IAdminRepository, remove configRef/registry/chains params
  Update createStatsRoutes to accept IStatsRepository, remove aggregator param
  Update createChatRoutes to pass userId into stats logging
  Verify: self-hosted mode still works (sqlite repos, userId ignored)
  VERIFY: SaaS mode end-to-end: add provider, list it, delete it via API
  RATIONALE: Blocked on Steps 1 (interfaces) and 4 (userId in context).

Step 6: Frontend auth
  Add ui/src/lib/supabase.ts client singleton
  Add AuthContext.tsx with onAuthStateChange
  Add Login.tsx and Signup.tsx pages
  Add ProtectedRoute.tsx
  Update main.tsx: AuthProvider wrapper, /login + /signup in router, ProtectedRoute on app routes
  Update Layout.tsx: replace API key input with auth status display + logout button
  Update api.ts: read session.access_token instead of sessionStorage API key
  Verify: sign up → redirect to dashboard; logout → redirect to /login
  RATIONALE: Blocked on Steps 4-5 (needs a working authenticated API to call).

Step 7: End-to-end integration
  Self-hosted smoke test: all existing routes still work with API key auth
  SaaS smoke test: sign up two users, add providers/chains as each user
  Verify: User A cannot see or modify User B's data
  Verify: chat completions log to correct user's request_logs row
```

**Why this order:**
- Steps 1-3 are pure backend with no auth dependency — all testable with hardcoded strings
- Step 4 (auth middleware) only makes sense once repos exist (Step 1) to receive the userId
- Step 5 (route wiring) needs both interfaces (Step 1) and the userId source (Step 4)
- Step 6 (frontend) is unblockable until the server API authenticates correctly (Steps 4-5)
- Self-hosted mode never breaks because SQLite repos exactly reproduce today's behavior

---

## Anti-Patterns

### Anti-Pattern 1: Sending the Service-Role Key to the Frontend

**What people do:** Set `VITE_SUPABASE_SERVICE_ROLE_KEY` so the React app can make direct Supabase queries.

**Why it's wrong:** `VITE_` env vars are embedded in the JavaScript bundle. Anyone who downloads the app can extract the service-role key. That key bypasses all RLS policies — full unrestricted database access.

**Do this instead:** The service-role key lives only in server environment variables (no `VITE_` prefix). The frontend only uses `VITE_SUPABASE_ANON_KEY`, which is safe to expose — RLS is enforced for every query made with it.

### Anti-Pattern 2: Using getSession() for Server-Side Authorization

**What people do:** On the Hono server, call `supabase.auth.getSession()` and trust the returned userId.

**Why it's wrong:** `getSession()` reads from a cookie or localStorage without verifying with the Auth server. A tampered or revoked token still returns data.

**Do this instead:** On the server, always call `supabase.auth.getUser(token)`. This makes a network request to Supabase Auth to verify the JWT is still valid and not revoked. On the frontend, `getSession()` is fine for rendering UI state.

### Anti-Pattern 3: Keeping In-Memory Registry and Chains as the Source of Truth in SaaS Mode

**What people do:** Reuse the startup-loaded `registry` (Map) and `chains` (Map) for SaaS mode, thinking they just need to add userId-scoping.

**Why it's wrong:** In self-hosted mode these Maps are loaded once from config at startup — they represent one user's data. In SaaS mode, each user has different providers and chains. A single in-memory Map cannot serve multiple tenants without loading all users' data into it, which scales poorly and leaks data across tenants.

**Do this instead:** In SaaS mode, the chat route must load the requesting user's providers and chains from Postgres on each request (or with a short TTL per-user cache). This is a significant architectural change to `createChatRoutes` that warrants its own implementation plan. Flag this as the primary complexity of the SaaS chat path.

### Anti-Pattern 4: Making SQLite Repository Methods Truly Async

**What people do:** Rewrite SQLiteAdminRepository using `async/await` around `better-sqlite3` calls because the interface is async.

**Why it's wrong:** `better-sqlite3` is synchronous by design — it blocks the Node.js thread but avoids callback overhead for fast local queries. Wrapping in unnecessary async does nothing except add microtask scheduling.

**Do this instead:** Return `Promise.resolve(result)` in SQLite implementations. The interface is async because the Supabase implementation is genuinely async. SQLite satisfies the contract by resolving immediately without doing async work.

### Anti-Pattern 5: Writing Separate RLS Policies for SELECT/INSERT/UPDATE/DELETE When FOR ALL Works

**What people do:** Write four separate CREATE POLICY statements per table (one per operation) for simple user-ownership scenarios.

**Why it's wrong:** Not wrong per se, but unnecessary verbosity for the simple `user_id = auth.uid()` pattern. It creates more policies to maintain.

**Do this instead:** Use `FOR ALL` with both `USING` (governs SELECT/UPDATE/DELETE row visibility) and `WITH CHECK` (governs INSERT/UPDATE row constraints) in a single policy. For this application's simple ownership model, `FOR ALL` is correct and concise.

---

## Scaling Considerations

| Scale | Architecture Notes |
|-------|-------------------|
| 0-500 users | Single Hono process, Supabase free tier, `getUser()` auth on every request is fine |
| 500-5k users | Switch to `getClaims()` if project uses asymmetric signing keys — eliminates auth network hop. Add Supabase connection pooler (built into Supabase dashboard). |
| 5k+ users | Per-user in-memory registry/chain cache with short TTL (see Anti-Pattern 3 above). Materialized aggregation tables in Postgres replace on-demand GROUP BY queries. |

**First bottleneck:** `getUser()` adds one network round-trip per API call to the Supabase Auth server. Switch to asymmetric signing + `getClaims()` early if latency is a concern — no code change needed beyond the middleware internals.

**Second bottleneck:** Loading providers and chains from Postgres per chat request in SaaS mode (no startup-loaded Maps). Address with a per-userId LRU cache with a 60-second TTL inside the chat route in SaaS mode.

---

## Sources

- [Use Supabase with Hono | Supabase Docs](https://supabase.com/docs/guides/getting-started/quickstarts/hono)
- [Row Level Security | Supabase Docs](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [JSON Web Token (JWT) | Supabase Docs](https://supabase.com/docs/guides/auth/jwts)
- [auth.getClaims() | Supabase JS Reference](https://supabase.com/docs/reference/javascript/auth-getclaims)
- [Password-based Auth | Supabase Docs](https://supabase.com/docs/guides/auth/passwords)
- [Use Supabase Auth with React | Supabase Docs](https://supabase.com/docs/guides/auth/quickstarts/react)
- [Hono Context API | Hono Docs](https://hono.dev/docs/api/context)
- [Type safety for middleware context variables | Hono Discussion #3257](https://github.com/orgs/honojs/discussions/3257)
- [Multi-Tenant Applications with RLS on Supabase | AntStack](https://www.antstack.com/blog/multi-tenant-applications-with-rls-on-supabase-postgress/)

---
*Architecture research for: 429chain v1.1 SaaS multi-tenant integration*
*Researched: 2026-03-01*
