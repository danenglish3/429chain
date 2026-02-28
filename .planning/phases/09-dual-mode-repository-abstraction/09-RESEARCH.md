# Phase 9: Dual-Mode Repository Abstraction - Research

**Researched:** 2026-03-01
**Domain:** TypeScript repository pattern / dependency injection / ESM dynamic imports
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ARCH-01 | App initializes in self-hosted mode (SQLite, no auth) when APP_MODE is not set or set to "self-hosted" | Factory pattern reads `process.env.APP_MODE` at startup; default branch instantiates existing SQLite classes |
| ARCH-02 | App initializes in SaaS mode (Supabase Auth + Postgres) when APP_MODE=saas with required env vars | Factory branch for `saas` returns stub implementations; no real Supabase imports in this phase |
| ARCH-03 | Repository interfaces abstract all data access (providers, chains, usage, logs) | `IAdminRepository` + `IStatsRepository` TypeScript interfaces defined in `src/persistence/repositories/interfaces.ts` |
| ARCH-04 | SQLite repository implementation wraps existing logic with no behavior change | `SqliteAdminRepository` delegates to existing `configRef` + `writeConfig`; `SqliteStatsRepository` delegates to existing `UsageAggregator` + `RequestLogger` |
| ARCH-06 | Repository factory selects implementation based on APP_MODE at startup | `createRepositories(mode)` factory in `src/persistence/repositories/factory.ts`; called once in `index.ts` |
| ARCH-07 | Self-hosted mode has zero dependency on Supabase packages at runtime | SaaS path uses `await import()` dynamic imports; no top-level Supabase imports anywhere in tree |
</phase_requirements>

---

## Summary

Phase 9 introduces a repository abstraction layer that wraps the existing SQLite persistence in typed interfaces without changing any observable behavior. The goal is to make the data access layer swappable: self-hosted keeps working exactly as today, while a future SaaS implementation can drop in by implementing the same interfaces.

The pattern is classic dependency injection with a factory. Two TypeScript interfaces (`IAdminRepository`, `IStatsRepository`) capture the operations currently performed by the admin routes and stats routes respectively. Two concrete classes (`SqliteAdminRepository`, `SqliteStatsRepository`) implement those interfaces by delegating directly to the existing `configRef`, `writeConfig`, `UsageAggregator`, and `RequestLogger` objects — no logic moves, only the call site changes. A factory function reads `APP_MODE` at startup and returns the appropriate pair of implementations. Routes receive the repositories through their existing dependency-injection pattern (passed as constructor arguments).

ARCH-07 is the most sensitive constraint: the SaaS code path must never be imported via static `import` at module load time. The safe pattern in ESM/Node.js is to keep the SaaS stub files isolated under `src/persistence/repositories/saas/` and load them only via `await import()` inside the factory's `saas` branch. This guarantees no Supabase package is evaluated even if it were installed.

**Primary recommendation:** Define interfaces first, wrap existing classes in one-liner delegating implementations, wire factory into `index.ts`, validate with a startup log line and the existing test suite.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript interfaces | built-in | Define `IAdminRepository` + `IStatsRepository` contracts | Zero runtime cost, full type safety, no new dependencies |
| Node.js dynamic import | built-in ESM | Isolate SaaS code path from static import tree | Only mechanism that guarantees deferred module evaluation in ESM |
| `better-sqlite3` | ^12.6.2 (already installed) | SQLite driver used by existing `UsageAggregator` + `RequestLogger` | Already in project; SQLite implementations just delegate |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vitest` | ^4.0.18 (already installed) | Test framework for repository wrapper unit tests | Used by all existing tests; new wrapper tests follow same pattern |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Thin delegating wrappers | Port all logic into the repository class | Risky: re-implementation risk, larger diff, harder to verify zero behavior change |
| Dynamic import for SaaS stub | Separate entry-point per mode | Entry-point approach is cleaner long-term but requires build changes; dynamic import is zero-config for this phase |

**Installation:**
```bash
# No new packages required for Phase 9
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── persistence/
│   ├── db.ts                          # unchanged
│   ├── schema.ts                      # unchanged
│   ├── request-logger.ts              # unchanged
│   ├── aggregator.ts                  # unchanged
│   └── repositories/
│       ├── interfaces.ts              # IAdminRepository + IStatsRepository
│       ├── factory.ts                 # createRepositories(mode) -> { admin, stats }
│       ├── sqlite/
│       │   ├── admin.ts               # SqliteAdminRepository implements IAdminRepository
│       │   └── stats.ts               # SqliteStatsRepository implements IStatsRepository
│       └── saas/
│           ├── admin.ts               # SaasAdminRepository stub (NotImplementedError)
│           └── stats.ts               # SaasStatsRepository stub (NotImplementedError)
```

### Pattern 1: Interface Definition

**What:** Pure TypeScript interfaces with no implementation. Methods mirror the existing operations in `admin.ts` and `stats.ts` routes.
**When to use:** Always — interfaces are the contract that makes the abstraction work.

```typescript
// src/persistence/repositories/interfaces.ts

import type { Config, ProviderConfig, ChainConfig } from '../../config/types.js';
import type { ProviderUsage, ChainUsage, RequestLogRow, SummaryStats } from '../aggregator.js';
import type { RequestLogEntry } from '../request-logger.js';

/**
 * Repository for managing providers and chains (admin operations).
 * Self-hosted: delegates to YAML config + writeConfig.
 * SaaS: reads/writes Postgres with RLS tenant isolation.
 */
export interface IAdminRepository {
  getConfig(): { providers: ProviderConfig[]; chains: ChainConfig[] };
  upsertProvider(provider: ProviderConfig): Promise<void>;
  deleteProvider(id: string): Promise<void>;
  upsertChain(chain: ChainConfig): Promise<void>;
  deleteChain(name: string): Promise<void>;
}

/**
 * Repository for reading usage statistics and logging requests.
 * Self-hosted: delegates to UsageAggregator + RequestLogger.
 * SaaS: reads/writes Postgres usage tables.
 */
export interface IStatsRepository {
  getSummaryStats(): SummaryStats;
  getAllProviderUsage(): ProviderUsage[];
  getProviderUsage(providerId: string): ProviderUsage | null;
  getAllChainUsage(): ChainUsage[];
  getChainUsage(chainName: string): ChainUsage | null;
  getRecentRequests(limit: number): RequestLogRow[];
  logRequest(entry: RequestLogEntry): void;
}
```

### Pattern 2: Thin Delegating SQLite Wrapper

**What:** Classes that hold references to existing objects and forward every call. Zero new logic.
**When to use:** This is the entire implementation strategy for ARCH-04 — wrap, never re-implement.

```typescript
// src/persistence/repositories/sqlite/stats.ts

import type { IStatsRepository } from '../interfaces.js';
import type { UsageAggregator } from '../../aggregator.js';
import type { RequestLogger } from '../../request-logger.js';
import type { RequestLogEntry } from '../../request-logger.js';

export class SqliteStatsRepository implements IStatsRepository {
  constructor(
    private readonly aggregator: UsageAggregator,
    private readonly logger: RequestLogger,
  ) {}

  getSummaryStats() { return this.aggregator.getSummaryStats(); }
  getAllProviderUsage() { return this.aggregator.getAllProviderUsage(); }
  getProviderUsage(id: string) { return this.aggregator.getProviderUsage(id); }
  getAllChainUsage() { return this.aggregator.getAllChainUsage(); }
  getChainUsage(name: string) { return this.aggregator.getChainUsage(name); }
  getRecentRequests(limit: number) { return this.aggregator.getRecentRequests(limit); }
  logRequest(entry: RequestLogEntry) { this.logger.logRequest(entry); }
}
```

### Pattern 3: Repository Factory with Dynamic SaaS Import

**What:** A factory function that reads `APP_MODE`, instantiates the correct pair of repositories, and returns them. SaaS path uses `await import()` to prevent static linking.
**When to use:** Called once in `index.ts` during bootstrap.

```typescript
// src/persistence/repositories/factory.ts

import type { IAdminRepository, IStatsRepository } from './interfaces.js';
import type { Config } from '../../config/types.js';
import type { UsageAggregator } from '../aggregator.js';
import type { RequestLogger } from '../request-logger.js';
import { logger } from '../../shared/logger.js';

export type AppMode = 'self-hosted' | 'saas';

export interface Repositories {
  admin: IAdminRepository;
  stats: IStatsRepository;
}

export async function createRepositories(
  mode: AppMode,
  // self-hosted dependencies (ignored in saas mode)
  deps?: {
    config: { current: Config };
    configPath: string;
    aggregator: UsageAggregator;
    requestLogger: RequestLogger;
  },
): Promise<Repositories> {
  if (mode === 'saas') {
    // Dynamic imports prevent Supabase packages from entering the module graph
    // when running in self-hosted mode
    const [{ SaasAdminRepository }, { SaasStatsRepository }] = await Promise.all([
      import('./saas/admin.js'),
      import('./saas/stats.js'),
    ]);
    logger.info('saas mode');
    return {
      admin: new SaasAdminRepository(),
      stats: new SaasStatsRepository(),
    };
  }

  // Default: self-hosted
  const { SqliteAdminRepository } = await import('./sqlite/admin.js');
  const { SqliteStatsRepository } = await import('./sqlite/stats.js');
  logger.info('self-hosted mode');
  return {
    admin: new SqliteAdminRepository(deps!.config, deps!.configPath),
    stats: new SqliteStatsRepository(deps!.aggregator, deps!.requestLogger),
  };
}
```

### Pattern 4: SaaS Stubs (NotImplementedError)

**What:** Placeholder implementations that throw immediately if called. Protects against accidentally relying on SaaS repos before Phase 11.
**When to use:** SaaS mode in Phase 9 only — stubs are replaced in Phase 11.

```typescript
// src/persistence/repositories/saas/admin.ts

import type { IAdminRepository } from '../interfaces.js';
import type { ProviderConfig, ChainConfig } from '../../../config/types.js';

export class SaasAdminRepository implements IAdminRepository {
  getConfig(): never { throw new Error('SaaS admin repository not yet implemented'); }
  async upsertProvider(_p: ProviderConfig): Promise<never> { throw new Error('Not implemented'); }
  async deleteProvider(_id: string): Promise<never> { throw new Error('Not implemented'); }
  async upsertChain(_c: ChainConfig): Promise<never> { throw new Error('Not implemented'); }
  async deleteChain(_name: string): Promise<never> { throw new Error('Not implemented'); }
}
```

### Pattern 5: Route Refactor to Accept Repository

**What:** Admin and stats routes currently receive concrete class instances directly. They must be updated to accept the interface type instead.
**When to use:** Required to complete the abstraction — routes must be interface-typed, not implementation-typed.

```typescript
// Before (src/api/routes/stats.ts):
export function createStatsRoutes(aggregator: UsageAggregator) { ... }

// After:
import type { IStatsRepository } from '../../persistence/repositories/interfaces.js';
export function createStatsRoutes(stats: IStatsRepository) { ... }
```

The admin route's `AdminRouteDeps` interface also changes:
```typescript
// Before: configRef + configPath exposed directly
// After: admin: IAdminRepository (configRef/configPath hidden inside SqliteAdminRepository)
```

### Pattern 6: Wiring APP_MODE in index.ts

**What:** `index.ts` reads `process.env.APP_MODE`, resolves the mode, calls `createRepositories()`, then passes repositories to routes.
**When to use:** Bootstrap only.

```typescript
// Near the top of index.ts, after config load
const rawMode = process.env['APP_MODE'] ?? 'self-hosted';
const appMode: AppMode = rawMode === 'saas' ? 'saas' : 'self-hosted';

// After database init...
const repos = await createRepositories(appMode, {
  config: configRef,
  configPath,
  aggregator,
  requestLogger,
});

// Pass to routes
const statsRoutes = createStatsRoutes(repos.stats);
const adminRoutes = createAdminRoutes({ admin: repos.admin, ... });
```

### Anti-Patterns to Avoid

- **Static import of SaaS files at top level:** Any `import ... from './saas/admin.js'` at the top of factory.ts or any ancestor defeats ARCH-07. Must use `await import()` inside the `saas` branch.
- **Re-implementing SQLite logic inside repository classes:** The wrapper classes must delegate to existing `UsageAggregator` and `RequestLogger`. Moving SQL into the wrapper class creates duplication and a behavior-change risk.
- **Mixing async and sync interfaces:** The current SQLite operations are synchronous (better-sqlite3 is sync). The `IStatsRepository` methods should remain sync where possible; `IAdminRepository` methods should be async-typed to allow SaaS implementations to use `await` internally without breaking the interface contract.
- **Removing configRef from admin route entirely before Phase 11:** `configRef.current` is still used by non-repository parts of `index.ts` (e.g., rate limit registration, default chain setting). Keep `configRef` alive in `index.ts`; only the admin route's data-access path moves to the repository.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Module-level lazy loading | Custom module cache / singleton registry | ESM `await import()` | Node.js module cache deduplicates; `await import()` is idempotent and built-in |
| Interface enforcement at runtime | Manual duck-typing checks | TypeScript `implements` keyword | Compile-time guarantee; no runtime overhead |
| Dependency injection container | Service locator / IoC container | Constructor injection (manual DI) | Project is simple enough; container adds complexity with no benefit here |

**Key insight:** This phase is a pure TypeScript structural change. The hard part is getting the interface boundaries right (sync vs. async, which data types cross the boundary) — not finding new libraries.

---

## Common Pitfalls

### Pitfall 1: async interface on a sync SQLite driver

**What goes wrong:** If `IAdminRepository.upsertProvider` is declared `async`, the SQLite implementation must return a `Promise` even though `better-sqlite3` is synchronous. Forgetting `async` or wrapping in `Promise.resolve()` causes TypeScript errors or runtime type mismatches.

**Why it happens:** The interface must accommodate both sync (SQLite) and async (future Supabase) implementations. The convention is to declare all mutating methods as `Promise<void>` in the interface — SQLite implementations just use `async` keyword (which auto-wraps the return).

**How to avoid:** Declare all write methods in both interfaces as `async` / `Promise<T>`. Read methods in `IStatsRepository` can be sync since both SQLite and any future implementation can return data synchronously (Postgres data will be pre-fetched via middleware or cached).

**Warning signs:** TypeScript error "Type 'void' is not assignable to type 'Promise<void>'" or vice versa on the SQLite implementation.

### Pitfall 2: Circular imports through interface re-exports

**What goes wrong:** If `interfaces.ts` imports types from `aggregator.ts` and `aggregator.ts` later imports from `interfaces.ts`, Node.js gives a circular dependency warning and some exports may be `undefined` at import time.

**Why it happens:** TypeScript type imports (`import type`) are erased at compile time and never cause circular dependency issues at runtime. But `import` (value imports) can.

**How to avoid:** Use `import type` for all cross-module type references in `interfaces.ts`. The interfaces file should have zero value imports — only type imports.

**Warning signs:** `Cannot read properties of undefined` at startup, or tsserver showing circular import warning.

### Pitfall 3: Admin route still holds configRef for rate-limit registration

**What goes wrong:** The admin route currently mutates `configRef.current` directly when providers/chains are added. If the route is refactored to use only `IAdminRepository`, but `index.ts` still reads `configRef.current` for other purposes (rate limit registration loop), the two become out of sync after an admin mutation.

**Why it happens:** `configRef` serves two purposes in today's code: (1) admin CRUD operations and (2) seed data for rate limit tracker registration. Phase 9 only needs to abstract purpose (1). Purpose (2) stays in `index.ts`.

**How to avoid:** Keep `configRef` alive in `index.ts`. `SqliteAdminRepository` receives `configRef` as a constructor argument and continues mutating it in-place. The admin route no longer needs to hold `configRef` directly — it calls repository methods. The repository mutates the shared `configRef` object internally so `index.ts` code still sees the changes.

**Warning signs:** After a provider is added via admin API, rate limit registration for that provider doesn't reflect the new provider.

### Pitfall 4: Test suite imports concrete classes directly

**What goes wrong:** New tests for repository wrappers that `import SqliteStatsRepository from './sqlite/stats.js'` and then test it through the `IStatsRepository` interface work fine — but if old tests import `UsageAggregator` directly and bypass the new repository layer, coverage of the abstraction is incomplete.

**Why it happens:** The existing test files for `aggregator.ts` and `request-logger.ts` test those classes in isolation, which is correct and should not change. New wrapper tests should test the wrapper's delegation behavior.

**How to avoid:** Write new test files specifically for the wrapper classes. Keep existing aggregator/logger tests unchanged.

### Pitfall 5: `index.ts` becomes async at top-level due to factory await

**What goes wrong:** `createRepositories()` returns a `Promise`. Today `index.ts` is a synchronous bootstrap script. Adding `await` requires wrapping the top-level code in an `async` IIFE or using top-level `await` (requires `"module": "ESNext"` / `"module": "NodeNext"` in tsconfig).

**Why it happens:** ESM supports top-level `await`, but it must be enabled explicitly in tsconfig and the project's `type: "module"` already enables it for `.mjs` files.

**How to avoid:** The project already has `"type": "module"` in `package.json`, and `tsdown` targets ESM. Top-level `await` is valid. Use it directly in `index.ts` — no IIFE needed.

**Warning signs:** TypeScript error `Top-level 'await' expressions are only allowed when the 'module' option is set to 'es2022'...`.

---

## Code Examples

Verified patterns from the existing codebase:

### Current admin route dependency shape (to be refactored)

```typescript
// src/api/routes/admin.ts (current)
interface AdminRouteDeps {
  configRef: { current: Config };
  configPath: string;
  registry: ProviderRegistry;
  chains: Map<string, Chain>;
  tracker: RateLimitTracker;
}
```

After Phase 9, the shape becomes:
```typescript
interface AdminRouteDeps {
  admin: IAdminRepository;   // replaces configRef + configPath
  registry: ProviderRegistry; // unchanged — not a repository concern
  chains: Map<string, Chain>; // still needed for runtime chain map updates
  tracker: RateLimitTracker;  // unchanged
}
```

Note: `chains: Map<string, Chain>` remains in `AdminRouteDeps` because the admin route also updates the in-memory chain map (`chains.set(name, runtimeChain)`). This is a runtime concern separate from persistence — the repository handles disk/DB persistence, the route still updates the in-memory map. This is intentional and stays in Phase 9.

### Current stats route dependency shape (to be refactored)

```typescript
// src/api/routes/stats.ts (current)
export function createStatsRoutes(aggregator: UsageAggregator)

// After Phase 9:
export function createStatsRoutes(stats: IStatsRepository)
```

### Current request-logger call in chat route

```typescript
// src/api/routes/chat.ts (current, approximate)
requestLogger.logRequest({ ... });

// After Phase 9: requestLogger is replaced by stats repository
statsRepo.logRequest({ ... });
```

This means `createChatRoutes` also needs its `requestLogger: RequestLogger` parameter updated to `stats: IStatsRepository`.

---

## Scope Boundary: What Phase 9 Does NOT Do

This is important for the planner to enforce:

1. **Does NOT introduce Supabase packages** — SaaS stubs throw `NotImplementedError`. Supabase packages (supabase-js, postgres.js) are NOT installed.
2. **Does NOT add authentication** — APP_MODE=saas just starts and logs; no JWT middleware, no user_id scoping.
3. **Does NOT change any API response shapes** — all HTTP responses from admin and stats routes are identical to today.
4. **Does NOT move SQL statements** — SQL stays in `aggregator.ts` and `schema.ts`; the wrapper classes delegate, not re-implement.
5. **Does NOT refactor provider/chain runtime logic** — `chains: Map<string, Chain>`, `registry`, and `tracker` remain as-is in routes. Only the persistence layer is abstracted.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^4.0.18 |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `npm test -- --run src/persistence` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ARCH-01 | App starts with no APP_MODE, existing behavior identical | smoke (manual) + unit for factory | `npm test -- --run src/persistence/repositories` | ❌ Wave 0 |
| ARCH-02 | APP_MODE=saas starts server, logs "saas mode", no Supabase imports | unit for factory + import scan | `npm test -- --run src/persistence/repositories` | ❌ Wave 0 |
| ARCH-03 | IAdminRepository + IStatsRepository interfaces exist with full method coverage | type-check (tsc --noEmit) | `npm run typecheck` | ❌ Wave 0 (interfaces file) |
| ARCH-04 | SQLite wrappers delegate to existing classes with no behavior change | unit — mock UsageAggregator/RequestLogger, assert delegation | `npm test -- --run src/persistence/repositories` | ❌ Wave 0 |
| ARCH-06 | Factory returns correct implementation based on mode | unit — call factory('self-hosted') and factory('saas'), assert instanceof | `npm test -- --run src/persistence/repositories` | ❌ Wave 0 |
| ARCH-07 | Self-hosted mode has zero Supabase import at runtime | import graph check or vitest test asserting saas files not in module | Manual or static analysis | ❌ |

### Sampling Rate

- **Per task commit:** `npm run typecheck`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/persistence/repositories/__tests__/factory.test.ts` — covers ARCH-01, ARCH-02, ARCH-06
- [ ] `src/persistence/repositories/__tests__/sqlite-admin.test.ts` — covers ARCH-04 (admin delegation)
- [ ] `src/persistence/repositories/__tests__/sqlite-stats.test.ts` — covers ARCH-04 (stats delegation)
- [ ] `src/persistence/repositories/interfaces.ts` — covers ARCH-03 (type-checked by tsc)
- [ ] `src/persistence/repositories/factory.ts` — covers ARCH-06
- [ ] `src/persistence/repositories/sqlite/admin.ts` — covers ARCH-04
- [ ] `src/persistence/repositories/sqlite/stats.ts` — covers ARCH-04
- [ ] `src/persistence/repositories/saas/admin.ts` — covers ARCH-02 (stub, not-implemented)
- [ ] `src/persistence/repositories/saas/stats.ts` — covers ARCH-02 (stub, not-implemented)

*(Existing test infrastructure covers the framework; only new repository files need new test files.)*

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Direct class injection (`UsageAggregator`, `RequestLogger`) | Interface injection (`IStatsRepository`) | Phase 9 | Routes become testable without a real SQLite DB |
| Config mutation in route handler | Delegated to `IAdminRepository` | Phase 9 | Admin route no longer knows about YAML/SQLite |
| Single-mode bootstrap | Mode-aware factory | Phase 9 | Future modes (SaaS) can plug in without touching route code |

---

## Open Questions

1. **Should `chains: Map<string, Chain>` move into `IAdminRepository`?**
   - What we know: The admin routes currently update both the persistent config (YAML) and the in-memory chain map atomically. The in-memory map is a runtime concern, not a persistence concern.
   - What's unclear: Whether it's cleaner to include in-memory map management in the admin repository, or leave it in the route handler.
   - Recommendation: Leave in-memory map management in the route handler for Phase 9. The repository only handles persistence. This keeps the interface simpler and avoids introducing runtime state into the repository layer before it's needed.

2. **Should `IAdminRepository.getConfig()` return `{ providers, chains }` or separate methods?**
   - What we know: The current `/admin/config` GET route returns both providers and chains in a single response.
   - What's unclear: Whether to model it as one method or two.
   - Recommendation: One method `getConfig(): { providers: ProviderConfig[]; chains: ChainConfig[] }` to match the existing route shape. Easier to implement and test.

3. **Pre-existing test failure: `cli.test.ts` has 5 Windows-specific EBUSY failures**
   - What we know: These are temp-dir cleanup race conditions on Windows, not related to repository abstraction. They existed before Phase 9.
   - Recommendation: Do not fix in this phase. Document as pre-existing. Phase 9 success criterion is "existing tests continue to pass" — the EBUSY failures are pre-existing and should be excluded from the gate.

---

## Sources

### Primary (HIGH confidence)

- Direct codebase analysis — `src/persistence/aggregator.ts`, `src/persistence/request-logger.ts`, `src/api/routes/admin.ts`, `src/api/routes/stats.ts`, `src/index.ts` — verified current class shapes and injection points
- `package.json` — confirmed `"type": "module"` (ESM top-level await supported), vitest version, no Supabase packages present
- TypeScript handbook (training knowledge, HIGH confidence for `interface` / `implements` / `import type` patterns — these are stable language features)

### Secondary (MEDIUM confidence)

- Node.js ESM documentation pattern for dynamic `await import()` to defer module loading — well-established pattern, verified in STATE.md project decisions ("Supabase imports must be dynamic and isolated to src/persistence/repositories/supabase/ only")
- `better-sqlite3` synchronous API (confirmed by existing `aggregator.ts` and `request-logger.ts` — no `await` anywhere in those files)

### Tertiary (LOW confidence)

- None — all claims in this document are grounded in direct codebase inspection or stable TypeScript/Node.js language features.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; all existing
- Architecture: HIGH — interfaces + factory + dynamic import are well-understood TypeScript/Node.js patterns verified against the actual codebase
- Pitfalls: HIGH — all pitfalls derive from direct analysis of the existing code (configRef dual-use, sync vs async interface mismatch, circular imports)

**Research date:** 2026-03-01
**Valid until:** Stable — TypeScript interface patterns don't change; revisit only if project dependencies change significantly
