# Phase 4: Observability & Persistence - Research

**Researched:** 2026-02-06
**Domain:** SQLite persistence, request logging, usage aggregation, REST API design
**Confidence:** HIGH

## Summary

Phase 4 adds observability to the 429chain proxy through SQLite-backed request logging, usage aggregation, and live rate limit status endpoints. The standard approach uses better-sqlite3 with WAL mode for concurrent access, asynchronous fire-and-forget logging to avoid blocking responses, and materialized aggregation tables updated via triggers for real-time stats queries.

The existing codebase provides excellent integration points: ChainResult and StreamChainResult already contain all necessary data (providerId, model, latencyMs, usage, attempts), and RateLimitTracker.getAllStatuses() exposes live rate limit state. The chat route's successful response path is the natural place to initiate async logging.

For streaming responses, token usage requires parsing the final SSE chunk when stream_options.include_usage is enabled, which OpenAI and compatible providers send after the [DONE] marker with the complete usage object.

**Primary recommendation:** Use better-sqlite3 with WAL mode, implement fire-and-forget async logging via setImmediate or dedicated logger service, create materialized aggregation tables with triggers for real-time stats, and expose REST endpoints at /v1/stats/* for usage queries and /v1/ratelimits for live status.

## Standard Stack

The established libraries/tools for SQLite + Node.js observability:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 12.6.2+ | SQLite driver | Fastest SQLite library for Node.js, synchronous API, full ESM support, active maintenance (Jan 2026 release) |
| pino | (existing) | Structured logging | Already in use, supports async transports for fire-and-forget |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:sqlite | Built-in (v22.5+) | Native SQLite | Only if avoiding dependencies, but still experimental (Stability 1.1) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| better-sqlite3 | node:sqlite built-in | Native module is experimental, synchronous-only, lacks production maturity |
| better-sqlite3 | sqlite3 (async) | Callback-based async API adds complexity, slower, worse ESM support |
| better-sqlite3 | sql.js (WASM) | Poor ESM integration, requires separate .wasm file management, slower |

**Installation:**
```bash
npm install better-sqlite3
```

**Note:** better-sqlite3 has native bindings that require compilation. Prebuilt binaries available for Node.js LTS versions (v14.21.1+). May require node-gyp on some systems.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── persistence/
│   ├── db.ts              # Database initialization, WAL mode setup
│   ├── schema.ts          # CREATE TABLE statements, migration logic
│   ├── logger.ts          # Request logging repository (insert operations)
│   └── aggregator.ts      # Usage aggregation queries (SELECT from materialized views)
├── api/
│   └── routes/
│       ├── stats.ts       # GET /v1/stats/* endpoints
│       └── ratelimits.ts  # GET /v1/ratelimits endpoint
```

### Pattern 1: Fire-and-Forget Async Logging
**What:** Initiate database writes without blocking HTTP response.
**When to use:** Request logging after successful chat completion responses.
**Example:**
```typescript
// In chat route after result
c.header('X-429chain-Provider', `${result.providerId}/${result.model}`);
c.header('X-429chain-Attempts', String(result.attempts.length + 1));

// Fire-and-forget: log asynchronously without awaiting
setImmediate(() => {
  try {
    requestLogger.logRequest({
      timestamp: Date.now(),
      chainName: chain.name,
      providerId: result.providerId,
      model: result.model,
      promptTokens: result.response.usage.prompt_tokens,
      completionTokens: result.response.usage.completion_tokens,
      totalTokens: result.response.usage.total_tokens,
      latencyMs: result.latencyMs,
      httpStatus: 200,
      attempts: result.attempts.length + 1,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to log request');
  }
});

return c.json(result.response);
```

**Critical:** Always wrap in try-catch to prevent unhandled rejections. Error handling must occur inside the background task since caller doesn't await.

### Pattern 2: Materialized Aggregation with Triggers
**What:** Use triggers to maintain real-time aggregate tables instead of expensive GROUP BY queries.
**When to use:** Per-provider and per-chain usage totals that must be fast to query.
**Example:**
```sql
-- Main request log table
CREATE TABLE request_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  chain_name TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  http_status INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);

-- Materialized aggregation table
CREATE TABLE usage_by_provider (
  provider_id TEXT PRIMARY KEY,
  total_requests INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  total_prompt_tokens INTEGER NOT NULL DEFAULT 0,
  total_completion_tokens INTEGER NOT NULL DEFAULT 0,
  last_request_timestamp INTEGER
);

-- Trigger to update aggregates on insert
CREATE TRIGGER update_provider_usage
AFTER INSERT ON request_logs
BEGIN
  INSERT INTO usage_by_provider (
    provider_id, total_requests, total_tokens,
    total_prompt_tokens, total_completion_tokens,
    last_request_timestamp
  )
  VALUES (
    NEW.provider_id, 1, NEW.total_tokens,
    NEW.prompt_tokens, NEW.completion_tokens,
    NEW.timestamp
  )
  ON CONFLICT(provider_id) DO UPDATE SET
    total_requests = total_requests + 1,
    total_tokens = total_tokens + NEW.total_tokens,
    total_prompt_tokens = total_prompt_tokens + NEW.prompt_tokens,
    total_completion_tokens = total_completion_tokens + NEW.completion_tokens,
    last_request_timestamp = NEW.timestamp;
END;
```

**Why:** Aggregation queries at read-time (SELECT SUM(...) GROUP BY) are expensive and slow. Triggers maintain aggregates in real-time with zero query cost.

### Pattern 3: WAL Mode Configuration
**What:** Enable Write-Ahead Logging for concurrent reads during writes.
**When to use:** Always, for web services with concurrent access.
**Example:**
```typescript
// Source: better-sqlite3 official docs
import Database from 'better-sqlite3';

const db = new Database('observability.db');

// Enable WAL mode (must be done before any queries)
db.pragma('journal_mode = WAL');

// Additional performance optimizations
db.pragma('synchronous = NORMAL');  // Faster than FULL, safe with WAL
db.pragma('cache_size = -64000');    // 64MB cache
db.pragma('temp_store = MEMORY');    // Keep temp tables in memory
```

**Why:** WAL mode allows readers to proceed concurrently with writers, dramatically improving performance under concurrent load. Default rollback journal mode blocks all readers during writes.

### Pattern 4: Streaming Token Capture
**What:** Parse final SSE chunk to extract token usage when streaming.
**When to use:** After [DONE] marker in streaming responses, when provider includes usage.
**Example:**
```typescript
// In streaming loop (chat.ts)
for (const data of result.events) {
  // Parse to check if this is the final usage chunk
  try {
    const parsed = JSON.parse(data);
    if (parsed.usage && parsed.usage.total_tokens) {
      // This is the final chunk with usage data
      capturedUsage = parsed.usage;
    }
  } catch {
    // Not JSON or doesn't have usage - normal content chunk
  }

  await stream.writeSSE({ data });
}

if (result.done) {
  await stream.writeSSE({ data: '[DONE]' });

  // Log streaming request with captured usage
  if (capturedUsage) {
    setImmediate(() => {
      requestLogger.logRequest({ /* ... usage from capturedUsage */ });
    });
  }
}
```

**Note:** OpenAI sends usage chunk when `stream_options: { include_usage: true }` is set. The usage object contains `prompt_tokens`, `completion_tokens`, `total_tokens`. Chunk may have empty `choices` array.

### Pattern 5: Transaction-Based Batch Inserts
**What:** Wrap multiple prepared statement executions in a transaction for performance.
**When to use:** Bulk operations, batch logging, or high-throughput scenarios.
**Example:**
```typescript
// Source: better-sqlite3 docs
const insert = db.prepare(
  'INSERT INTO request_logs (timestamp, chain_name, provider_id, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, http_status, attempts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);

// Create transaction function
const insertMany = db.transaction((requests) => {
  for (const req of requests) {
    insert.run(
      req.timestamp,
      req.chainName,
      req.providerId,
      req.model,
      req.promptTokens,
      req.completionTokens,
      req.totalTokens,
      req.latencyMs,
      req.httpStatus,
      req.attempts
    );
  }
});

// Execute all inserts in single transaction
insertMany(requestArray);
```

**Why:** Transactions are 10-100x faster than individual inserts. Single fsync() at commit instead of per-insert.

### Anti-Patterns to Avoid
- **Awaiting database writes in request path:** Adds latency. Use fire-and-forget instead.
- **SELECT SUM(...) GROUP BY at query time:** Expensive. Use materialized views with triggers.
- **Not enabling WAL mode:** Severely limits concurrent read performance.
- **Mixed timestamp formats:** Inconsistent DATE vs INTEGER vs TEXT causes query complexity and errors.
- **No error handling in fire-and-forget:** Leads to unhandled promise rejections and crashes.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schema migrations | Custom version tracking | PRAGMA user_version + migration array | SQLite has built-in schema version, migration tools expect this |
| Date/time handling | Custom parsing | ISO8601 TEXT or INTEGER unix timestamps | SQLite date functions work with these formats, custom formats break |
| Connection pooling | Custom pool manager | Single connection (better-sqlite3 is synchronous) | Synchronous API doesn't need pooling, causes contention |
| Async wrapper for better-sqlite3 | Promise-based wrapper | Fire-and-forget pattern or worker threads | Adding async wrapper negates performance benefits |

**Key insight:** better-sqlite3 is intentionally synchronous because it's faster. The Node.js ecosystem has evolved fire-and-forget patterns and worker thread approaches instead of forcing async wrappers. Custom solutions miss edge cases (WAL checkpoint management, busy handlers, transaction rollback).

## Common Pitfalls

### Pitfall 1: ESM Dynamic Import Incompatibility
**What goes wrong:** better-sqlite3 uses native bindings that load synchronously, but ESM dynamic imports are async.
**Why it happens:** SQLite class constructors must be synchronous, but ESM top-level await isn't universally supported in older Node versions.
**How to avoid:** Use static import `import Database from 'better-sqlite3'` at module level. Don't use dynamic `await import()`.
**Warning signs:** "Cannot use import statement outside a module" or constructor errors.

### Pitfall 2: Forgetting WAL Checkpoint Management
**What goes wrong:** Read performance degrades over time as WAL file grows unbounded.
**Why it happens:** WAL mode doesn't automatically checkpoint (merge WAL back to main DB).
**How to avoid:** Call `db.pragma('wal_checkpoint(PASSIVE)')` periodically or let SQLite auto-checkpoint (default every 1000 pages).
**Warning signs:** Query performance degrades over hours/days, WAL file grows to hundreds of MB.

### Pitfall 3: Capturing Streaming Tokens Without stream_options
**What goes wrong:** Streaming responses never receive usage data, can't log token counts.
**Why it happens:** OpenAI and compatible APIs don't send usage by default in streaming mode.
**How to avoid:** When streaming, ensure upstream request includes `stream_options: { include_usage: true }`. Parse final chunk (not [DONE]) for usage object.
**Warning signs:** usage field is undefined/null in streaming logs, only non-streaming has token counts.

### Pitfall 4: Blocking Response with Synchronous DB Writes
**What goes wrong:** Request latency increases by database write time (5-50ms per insert).
**Why it happens:** Developers naturally await database operations, blocking return.
**How to avoid:** Use `setImmediate(() => { db.prepare(...).run(...) })` pattern. Return response immediately.
**Warning signs:** Response latency spikes when logging is added, P99 latency increases significantly.

### Pitfall 5: INTEGER vs TEXT Timestamp Inconsistency
**What goes wrong:** Queries mixing `timestamp > 123456789` and `timestamp > '2026-01-01'` fail or return wrong results.
**Why it happens:** SQLite has no timestamp type, application must enforce consistency.
**How to avoid:** Choose one format (INTEGER unix ms recommended for performance) and use consistently. Document in schema comments.
**Warning signs:** Date range queries return unexpected results, aggregation by day/hour breaks.

### Pitfall 6: Unhandled Errors in Fire-and-Forget
**What goes wrong:** Database write failures cause unhandled promise rejection, crashing Node.js process.
**Why it happens:** Async operations without await and no .catch() handler.
**How to avoid:** Always wrap fire-and-forget logic in try-catch. Log errors but don't propagate.
**Warning signs:** Process crashes with "UnhandledPromiseRejectionWarning", logs show database errors before crash.

### Pitfall 7: Creating Indexes After Data Ingestion
**What goes wrong:** Index creation takes minutes/hours on large tables, blocking all writes.
**Why it happens:** Indexes not included in initial schema, added later as optimization.
**How to avoid:** Define indexes in initial schema. Critical indexes: `CREATE INDEX idx_requests_timestamp ON request_logs(timestamp)`, `CREATE INDEX idx_requests_provider ON request_logs(provider_id, model)`.
**Warning signs:** Range queries slow even on small datasets, EXPLAIN QUERY PLAN shows full table scan.

## Code Examples

Verified patterns from official sources and established practices:

### Database Initialization
```typescript
// Source: better-sqlite3 npm package docs
import Database from 'better-sqlite3';
import { logger } from '../shared/logger.js';

export function initializeDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  // Enable WAL mode for concurrent access
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');  // Safe with WAL
  db.pragma('cache_size = -64000');   // 64MB cache

  logger.info({ dbPath, mode: 'WAL' }, 'Database initialized');

  return db;
}
```

### Schema with Indexes
```sql
-- Timestamp as INTEGER (unix milliseconds) for performance
-- ISO8601 TEXT alternative: 'YYYY-MM-DD HH:MM:SS.SSS'
CREATE TABLE IF NOT EXISTS request_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,           -- Date.now() unix milliseconds
  chain_name TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  http_status INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);

-- Critical indexes for query patterns
CREATE INDEX IF NOT EXISTS idx_logs_timestamp
  ON request_logs(timestamp DESC);      -- Time-range queries

CREATE INDEX IF NOT EXISTS idx_logs_provider
  ON request_logs(provider_id, model);  -- Per-provider aggregation

CREATE INDEX IF NOT EXISTS idx_logs_chain
  ON request_logs(chain_name);          -- Per-chain aggregation

-- Materialized aggregation tables
CREATE TABLE IF NOT EXISTS usage_by_provider (
  provider_id TEXT PRIMARY KEY,
  total_requests INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  total_prompt_tokens INTEGER NOT NULL DEFAULT 0,
  total_completion_tokens INTEGER NOT NULL DEFAULT 0,
  last_request_timestamp INTEGER
);

CREATE TABLE IF NOT EXISTS usage_by_chain (
  chain_name TEXT PRIMARY KEY,
  total_requests INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  total_prompt_tokens INTEGER NOT NULL DEFAULT 0,
  total_completion_tokens INTEGER NOT NULL DEFAULT 0,
  last_request_timestamp INTEGER
);

-- Triggers to maintain aggregates
CREATE TRIGGER IF NOT EXISTS update_provider_usage
AFTER INSERT ON request_logs
BEGIN
  INSERT INTO usage_by_provider (
    provider_id, total_requests, total_tokens,
    total_prompt_tokens, total_completion_tokens,
    last_request_timestamp
  )
  VALUES (
    NEW.provider_id, 1, NEW.total_tokens,
    NEW.prompt_tokens, NEW.completion_tokens,
    NEW.timestamp
  )
  ON CONFLICT(provider_id) DO UPDATE SET
    total_requests = total_requests + 1,
    total_tokens = total_tokens + NEW.total_tokens,
    total_prompt_tokens = total_prompt_tokens + NEW.prompt_tokens,
    total_completion_tokens = total_completion_tokens + NEW.completion_tokens,
    last_request_timestamp = MAX(last_request_timestamp, NEW.timestamp);
END;

CREATE TRIGGER IF NOT EXISTS update_chain_usage
AFTER INSERT ON request_logs
BEGIN
  INSERT INTO usage_by_chain (
    chain_name, total_requests, total_tokens,
    total_prompt_tokens, total_completion_tokens,
    last_request_timestamp
  )
  VALUES (
    NEW.chain_name, 1, NEW.total_tokens,
    NEW.prompt_tokens, NEW.completion_tokens,
    NEW.timestamp
  )
  ON CONFLICT(chain_name) DO UPDATE SET
    total_requests = total_requests + 1,
    total_tokens = total_tokens + NEW.total_tokens,
    total_prompt_tokens = total_prompt_tokens + NEW.prompt_tokens,
    total_completion_tokens = total_completion_tokens + NEW.completion_tokens,
    last_request_timestamp = MAX(last_request_timestamp, NEW.timestamp);
END;
```

### Request Logger Repository
```typescript
// Source: better-sqlite3 API patterns
import type Database from 'better-sqlite3';

export interface RequestLogEntry {
  timestamp: number;
  chainName: string;
  providerId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  httpStatus: number;
  attempts: number;
}

export class RequestLogger {
  private insertStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.insertStmt = db.prepare(`
      INSERT INTO request_logs (
        timestamp, chain_name, provider_id, model,
        prompt_tokens, completion_tokens, total_tokens,
        latency_ms, http_status, attempts
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  logRequest(entry: RequestLogEntry): void {
    this.insertStmt.run(
      entry.timestamp,
      entry.chainName,
      entry.providerId,
      entry.model,
      entry.promptTokens,
      entry.completionTokens,
      entry.totalTokens,
      entry.latencyMs,
      entry.httpStatus,
      entry.attempts
    );
  }
}
```

### Usage Aggregation Queries
```typescript
export interface ProviderUsage {
  providerId: string;
  totalRequests: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  lastRequestTimestamp: number | null;
}

export class UsageAggregator {
  private getProviderUsageStmt: Database.Statement;
  private getAllProviderUsageStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.getProviderUsageStmt = db.prepare(`
      SELECT
        provider_id as providerId,
        total_requests as totalRequests,
        total_tokens as totalTokens,
        total_prompt_tokens as totalPromptTokens,
        total_completion_tokens as totalCompletionTokens,
        last_request_timestamp as lastRequestTimestamp
      FROM usage_by_provider
      WHERE provider_id = ?
    `);

    this.getAllProviderUsageStmt = db.prepare(`
      SELECT
        provider_id as providerId,
        total_requests as totalRequests,
        total_tokens as totalTokens,
        total_prompt_tokens as totalPromptTokens,
        total_completion_tokens as totalCompletionTokens,
        last_request_timestamp as lastRequestTimestamp
      FROM usage_by_provider
      ORDER BY last_request_timestamp DESC
    `);
  }

  getProviderUsage(providerId: string): ProviderUsage | null {
    return this.getProviderUsageStmt.get(providerId) as ProviderUsage | undefined ?? null;
  }

  getAllProviderUsage(): ProviderUsage[] {
    return this.getAllProviderUsageStmt.all() as ProviderUsage[];
  }

  // Similar methods for chain usage...
}
```

### Stats API Endpoints
```typescript
// Source: REST API design patterns for metrics
import { Hono } from 'hono';
import type { UsageAggregator } from '../../persistence/aggregator.js';

export function createStatsRoutes(aggregator: UsageAggregator) {
  const app = new Hono();

  // GET /v1/stats/providers - All provider usage totals
  app.get('/providers', (c) => {
    const usage = aggregator.getAllProviderUsage();
    return c.json({ providers: usage });
  });

  // GET /v1/stats/providers/:providerId - Single provider usage
  app.get('/providers/:providerId', (c) => {
    const providerId = c.req.param('providerId');
    const usage = aggregator.getProviderUsage(providerId);

    if (!usage) {
      return c.json({ error: 'Provider not found or no usage data' }, 404);
    }

    return c.json(usage);
  });

  // GET /v1/stats/chains - All chain usage totals
  app.get('/chains', (c) => {
    const usage = aggregator.getAllChainUsage();
    return c.json({ chains: usage });
  });

  return app;
}
```

### Rate Limit Status API
```typescript
// Integration with existing RateLimitTracker
import { Hono } from 'hono';
import type { RateLimitTracker } from '../../ratelimit/tracker.js';

export function createRateLimitRoutes(tracker: RateLimitTracker) {
  const app = new Hono();

  // GET /v1/ratelimits - All tracked rate limit statuses
  app.get('/', (c) => {
    const statuses = tracker.getAllStatuses();
    return c.json({
      ratelimits: statuses.map(entry => ({
        provider: entry.providerId,
        model: entry.model,
        status: entry.status,
        cooldownUntil: entry.cooldownUntil,
        reason: entry.reason,
        quota: entry.quota ? {
          remainingRequests: entry.quota.remainingRequests,
          remainingTokens: entry.quota.remainingTokens,
          resetRequestsMs: entry.quota.resetRequestsMs,
          resetTokensMs: entry.quota.resetTokensMs,
          lastUpdated: entry.quota.lastUpdated,
        } : null,
      })),
    });
  });

  return app;
}
```

### Schema Migration Pattern
```typescript
// Source: SQLite user_version pragma for migrations
export function migrateSchema(db: Database.Database): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;

  const migrations = [
    // Version 1: Initial schema
    () => {
      db.exec(`
        CREATE TABLE request_logs (...);
        CREATE INDEX idx_logs_timestamp ON request_logs(timestamp);
        -- ... rest of schema
      `);
    },
    // Version 2: Add new columns or tables
    () => {
      db.exec(`
        ALTER TABLE request_logs ADD COLUMN request_id TEXT;
        CREATE INDEX idx_logs_request_id ON request_logs(request_id);
      `);
    },
    // Future migrations...
  ];

  for (let i = currentVersion; i < migrations.length; i++) {
    logger.info({ fromVersion: i, toVersion: i + 1 }, 'Running migration');
    migrations[i]();
    db.pragma(`user_version = ${i + 1}`);
  }

  logger.info({ version: migrations.length }, 'Schema migration complete');
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| sqlite3 (async callback) | better-sqlite3 (sync) | ~2017-2018 | 2-10x faster, simpler API, better for Node.js event loop |
| Rollback journal mode | WAL mode | SQLite 3.7.0 (2010) | Concurrent readers + writers, essential for web services |
| Runtime aggregation queries | Materialized views with triggers | Ongoing | O(1) vs O(n) query time, enables real-time stats |
| Manual fire-and-forget | setImmediate + try-catch pattern | Node.js 0.10+ (2013) | Cleaner async without promises, lower overhead |
| OpenAI no streaming usage | stream_options.include_usage | May 2024 | Finally enables token tracking in streaming mode |
| node:sqlite experimental | Node.js built-in (v22.5+) | Aug 2024 | Zero-dependency option, but still not production-ready (Stability 1.1) |

**Deprecated/outdated:**
- **sqlite3 package:** Still maintained but callback-based API is outdated. better-sqlite3 is now standard for new projects.
- **node:sqlite without stability warning:** Still experimental (1.1), not recommended for production despite being built-in.
- **Custom async wrappers for better-sqlite3:** Negates performance benefits. Use fire-and-forget or worker threads instead.

## Open Questions

Things that couldn't be fully resolved:

1. **Node.js native SQLite maturity timeline**
   - What we know: node:sqlite exists in v22.5+ but is Stability 1.1 (Active Development), lacks async API
   - What's unclear: When/if it will reach Stability 2 (Stable) and whether async support is planned
   - Recommendation: Use better-sqlite3 for production. Monitor node:sqlite for v24+ LTS stabilization

2. **Optimal checkpoint interval for request logging**
   - What we know: SQLite auto-checkpoints every 1000 pages by default, manual checkpoints can be triggered
   - What's unclear: At what request volume manual checkpoint tuning becomes necessary
   - Recommendation: Start with defaults, monitor WAL file size. If WAL grows >100MB, add periodic `PRAGMA wal_checkpoint(PASSIVE)` every 10k requests

3. **Database file location and backup strategy**
   - What we know: SQLite is single-file, WAL creates -wal and -shm auxiliary files
   - What's unclear: Best practice for file location (./data/, /var/lib/, user-configurable?)
   - Recommendation: Make configurable via config.settings.observabilityDbPath, default to ./data/observability.db, document that backups require copying all three files (db, -wal, -shm) or running checkpoint first

4. **Historical data retention policy**
   - What we know: request_logs table grows unbounded at ~100-200 bytes per request
   - What's unclear: Whether to implement automatic pruning (delete older than N days) or leave to user
   - Recommendation: Document growth rate, defer pruning to v2 or document manual cleanup queries

## Sources

### Primary (HIGH confidence)
- [better-sqlite3 GitHub](https://github.com/WiseLibs/better-sqlite3) - ESM support, version 12.6.2 confirmed
- [better-sqlite3 npm](https://www.npmjs.com/package/better-sqlite3) - Official API documentation
- [Node.js SQLite Documentation](https://nodejs.org/api/sqlite.html) - Native module capabilities and limitations
- [SQLite WAL Mode](https://sqlite.org/wal.html) - Official documentation on Write-Ahead Logging
- [SQLite Datatypes](https://sqlite.org/datatype3.html) - Timestamp storage best practices
- [SQLite Date Functions](https://sqlite.org/lang_datefunc.html) - ISO8601 and unix timestamp handling

### Secondary (MEDIUM confidence)
- [How to Use SQLite in Node.js Applications (2026-02-02)](https://oneuptime.com/blog/post/2026-02-02-sqlite-nodejs/view) - Recent WAL mode guidance
- [Understanding Better-SQLite3](https://dev.to/lovestaco/understanding-better-sqlite3-the-fastest-sqlite-library-for-nodejs-4n8) - Performance patterns
- [OpenAI Community: Usage stats in streaming](https://community.openai.com/t/usage-stats-now-available-when-using-streaming-with-the-chat-completions-api-or-completions-api/738156) - stream_options.include_usage feature
- [Fire and Forget in Node.js](https://medium.com/@dev.chetan.rathor/understanding-fire-and-forget-in-node-js-what-it-really-means-a83705aca4eb) - Async logging patterns
- [Contextual Logging Done Right in Node.js](https://www.dash0.com/guides/contextual-logging-in-nodejs) - AsyncLocalStorage for request context

### Tertiary (LOW confidence)
- General web search results on REST API design patterns for stats endpoints
- General web search results on SQLite indexing best practices

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - better-sqlite3 is widely documented, actively maintained (Jan 2026), clear ESM support
- Architecture: HIGH - WAL mode, fire-and-forget, and materialized views are established patterns with official documentation
- Streaming token capture: HIGH - OpenAI community confirmed stream_options.include_usage feature (May 2024)
- Integration points: HIGH - Direct inspection of existing codebase (ChainResult, StreamChainResult, RateLimitTracker)
- Pitfalls: MEDIUM - Derived from better-sqlite3 GitHub issues, SQLite forum, and Node.js ESM challenges

**Research date:** 2026-02-06
**Valid until:** ~2026-03-06 (30 days - stable ecosystem, but monitor Node.js native SQLite evolution)
