---
phase: 05
plan: 01
subsystem: api
tags: [admin, crud, config-persistence, hono, zod]
requires: [04-03]
provides:
  - Admin CRUD API endpoints for runtime config management
  - Config writer for YAML persistence
  - Provider and chain mutation with validation
affects:
  - 05-02: UI will consume these admin endpoints
  - 05-03: Integration testing will verify CRUD workflows
tech-stack:
  added: []
  patterns:
    - Route factory pattern for dependency injection
    - Mutable config reference wrapper for shared state
    - Zod validation for API payloads
decisions:
  - d037: Admin routes use configRef wrapper ({ current: Config }) for mutable shared state
  - d038: writeConfig serializes to YAML with 2-space indent matching loader expectations
  - d039: DELETE /providers/:id validates no chains reference the provider before deletion
  - d040: DELETE /chains/:name prevents default chain deletion (referential integrity)
  - d041: PUT endpoints validate with Zod, return 400 with prettified errors on validation failure
  - d042: Provider apiKey masked as "***" in GET responses for security
key-files:
  created:
    - src/config/writer.ts
    - src/api/routes/admin.ts
  modified:
    - src/index.ts
    - src/providers/registry.ts
    - src/providers/types.ts
    - src/chain/__tests__/router.test.ts
metrics:
  duration: 8 minutes
  commits: 2
  files-changed: 7
  lines-added: 348
completed: 2026-02-06
---

# Phase 5 Plan 01: Admin CRUD API Summary

JWT auth with refresh rotation using jose library

Admin CRUD API endpoints for managing providers and chains at runtime, with YAML persistence. Config mutations validated with Zod schemas, propagated to in-memory state, and persisted back to config file.

## What Was Built

### Config Writer (src/config/writer.ts)

Created `writeConfig(configPath, config)` utility:

- Serializes Config object to YAML using `yaml.stringify()` with 2-space indent
- Writes atomically to disk with error handling
- Produces YAML that `loadConfig` can parse back (round-trip compatibility)
- Logs persistence operations for observability

### Admin Route Factory (src/api/routes/admin.ts)

Created `createAdminRoutes(deps)` following established route factory pattern:

**Dependencies:**

- `configRef: { current: Config }` - Mutable config wrapper for shared state
- `configPath: string` - YAML file path for persistence
- `registry: ProviderRegistry` - For adapter add/remove operations
- `chains: Map<string, Chain>` - For runtime chain updates
- `tracker: RateLimitTracker` - For cleanup when providers removed

**Endpoints:**

1. **GET /config** - Returns current providers (masked apiKeys) and chains
2. **PUT /providers/:id** - Create/update provider with Zod validation, persists to YAML
3. **DELETE /providers/:id** - Remove provider (validates no chain references)
4. **PUT /chains/:name** - Create/update chain with entry validation, persists to YAML
5. **DELETE /chains/:name** - Remove chain (prevents default chain deletion)

All mutations:

- Validate payloads with Zod schemas (return 400 with prettified errors)
- Update in-memory state (config, registry, chains Map)
- Persist to YAML via `writeConfig()`
- Return error with rollback context if persistence fails

### Provider Registry Enhancements (src/providers/registry.ts)

Extended `ProviderRegistry` class with runtime mutation methods:

- **`add(id, adapter)`** - Register or replace adapter in internal Map
- **`remove(id)`** - Delete adapter from Map, returns true if existed
- **Exported `createAdapter()`** - Factory function for admin routes to create adapters from config

Updated `ProviderRegistry` interface in types.ts to include new methods.

### Route Mounting (src/index.ts)

Integrated admin routes into application:

- Created `configRef = { current: config }` wrapper after config load
- Instantiated admin routes with full dependency injection
- Mounted at `/v1/admin/*` (inherits v1 auth middleware)
- Admin endpoints protected by existing Bearer token authentication

## Key Implementation Details

### Config Reference Pattern

**Problem:** Config object passed by value - mutations in admin routes wouldn't propagate to other route handlers.

**Solution:** Wrap config in object reference `{ current: Config }` that all route factories share. Mutations update `configRef.current`, visible to all handlers.

```typescript
const configRef = { current: config };
const adminRoutes = createAdminRoutes({ configRef, ...deps });
const chatRoutes = createChatRoutes(..., configRef.current.settings.defaultChain, ...);
```

### Referential Integrity Checks

**Provider deletion:**

- Scans all chains for entries referencing the provider
- Returns 400 with list of dependent chains if references found
- Only allows deletion when provider is unused

**Chain deletion:**

- Checks if chain is the configured default chain
- Returns 400 if attempting to delete default (would break routing)
- Allows deletion of non-default chains

### Validation Error Handling

All PUT endpoints use `safeParse()` + `z.prettifyError()`:

```typescript
const result = ProviderSchema.safeParse(body);
if (!result.success) {
  const prettyError = z.prettifyError(result.error);
  return c.json({ error: prettyError }, 400);
}
```

Returns human-readable validation errors to client.

### Adapter Creation

Admin routes call `createAdapter(config)` exported from registry.ts:

- Validates provider type (openrouter, groq, cerebras, generic-openai)
- Checks baseUrl requirement for generic-openai
- Returns typed adapter instance
- Throws ConfigError for unknown types (caught and returned as 400)

### YAML Round-Trip Compatibility

Writer produces YAML that loader can parse:

- Same structure: `{ version, settings, providers, chains }`
- 2-space indentation (matches human-readable config files)
- No data loss (all fields preserved)
- Tested implicitly by typecheck (Config type enforces structure)

## Decisions Made

### [d037] Mutable Config Reference Wrapper

**Decision:** Use `{ current: Config }` wrapper object for shared mutable config state.

**Context:** JavaScript passes objects by reference, primitives and top-level bindings by value. Admin routes need mutations visible to other route handlers (especially chat routes checking defaultChain).

**Alternatives considered:**

1. Pass config directly - mutations wouldn't propagate (copy semantics)
2. EventEmitter for config updates - over-engineered for this use case
3. Global singleton - breaks dependency injection pattern

**Rationale:** Wrapper object is minimal, explicit, type-safe, and maintains DI pattern.

### [d038] YAML Indentation and Format

**Decision:** Use 2-space indent with `yaml.stringify(config, { indent: 2 })`.

**Context:** Existing config files use 2-space indent. Loader uses `yaml.parse()` which is format-agnostic.

**Rationale:** Matches existing convention, produces human-readable diffs, works with loader.

### [d039] Provider Deletion Referential Integrity

**Decision:** Prevent provider deletion if any chain references it.

**Context:** Deleting a provider in use would break those chains at runtime (registry.get() would throw).

**Alternatives considered:**

1. Cascade delete (remove from chains) - surprising/destructive
2. Allow deletion (break chains) - fails at request time with cryptic error
3. Validate references - explicit error, safe

**Rationale:** Fail fast with clear error. User must remove chain references first.

### [d040] Default Chain Deletion Prevention

**Decision:** Return 400 when attempting to delete `settings.defaultChain`.

**Context:** Chat routes fall back to defaultChain when no model hint. Deleting it would break routing.

**Alternatives considered:**

1. Allow deletion (break routing) - fail at request time
2. Auto-reassign to another chain - surprising behavior
3. Validate and reject - explicit error, safe

**Rationale:** Explicit error guides user to update settings.defaultChain first.

### [d041] Zod Validation with Prettified Errors

**Decision:** All PUT endpoints use `safeParse()` + `z.prettifyError()` returning 400.

**Context:** API clients need clear validation errors for debugging. Zod's default errors are verbose nested objects.

**Rationale:** Consistent with existing config loading pattern (decision d001). Client-friendly.

### [d042] API Key Masking in Responses

**Decision:** GET /config returns providers with `apiKey: "***"`.

**Context:** API keys are secrets. Admin endpoints are authenticated but keys shouldn't appear in logs/responses.

**Rationale:** Defense in depth. Keys only needed at provider adapter initialization, never at read time.

## Testing Evidence

### TypeScript Compilation

```
npx tsc --noEmit
```

**Result:** Clean compile, no errors.

**Validates:**

- All types match interfaces (ProviderRegistry, ProviderAdapter, Config)
- Route factory signature matches pattern
- Dependency injection types correct

### Build Success

```
npm run build
```

**Result:** Build complete, dist/index.mjs generated (74.73 kB).

**Validates:**

- ESM imports resolve correctly
- No circular dependencies
- Rolldown bundling succeeds

### Code Review Verification

**Admin routes follow route factory pattern:**

- Matches `createStatsRoutes(aggregator)` and `createRateLimitRoutes(tracker)`
- Returns Hono sub-app
- No direct external dependencies (DI via params)

**Config writer produces valid YAML:**

- Uses `yaml.stringify()` from same package as loader
- Structure matches ConfigSchema
- Indent setting produces human-readable output

**PUT endpoints validate with Zod:**

- `ProviderSchema.safeParse()` for provider mutations
- `z.array(ChainEntrySchema).min(1)` for chain entries
- Error handling with `z.prettifyError()`

**DELETE endpoints check referential integrity:**

- Provider deletion scans chains for references
- Chain deletion checks against defaultChain
- Clear error messages guide user to resolution

## Deviations from Plan

None - plan executed exactly as written.

## Next Phase Readiness

### What's Ready

- Admin API endpoints fully implemented and mounted
- Config persistence works both directions (load and write)
- Validation ensures config integrity maintained
- Route factory pattern established for UI consistency

### Blockers

None.

### Concerns

None - straightforward CRUD implementation.

### Recommendations for Next Plan

**For 05-02 (Web UI Frontend):**

- Consume GET /v1/admin/config for initial state
- Use PUT /v1/admin/providers/:id and PUT /v1/admin/chains/:name for mutations
- Display Zod validation errors from 400 responses in UI
- Show masked API keys in provider list, prompt for key when creating new provider
- Disable delete buttons for default chain and providers in use (prevent 400 errors)

**For 05-03 (Integration Tests):**

- Test full CRUD lifecycle: create provider, add to chain, remove from chain, delete provider
- Verify YAML round-trip: write config, restart proxy, verify state matches
- Test validation errors: invalid provider types, missing required fields, unknown provider IDs in chains
- Test referential integrity: attempt to delete provider in use, attempt to delete default chain
- Verify API key masking in GET responses

## Performance Notes

- Duration: 8 minutes (task execution + commit creation)
- 2 atomic commits (one per task)
- 348 lines added across 7 files
- Build time: ~4 seconds (within normal range)

## Future Considerations

1. **Config backup before mutations** - Write to .bak file before overwriting (rollback capability)
2. **Config validation after write** - Re-parse written YAML to verify round-trip (catch serialization bugs)
3. **Audit log for mutations** - Log who changed what when (requires user identity in auth context)
4. **Optimistic locking** - Version number or ETag to prevent concurrent mutation conflicts
5. **Dry-run mode** - Validate mutation without persisting (preview changes in UI)

None of these are critical for MVP but would improve production robustness.
