# Stack Research

**Domain:** AI inference proxy/aggregator
**Researched:** 2026-02-05
**Confidence:** MEDIUM (WebSearch/WebFetch unavailable; versions based on May 2025 training data -- verify before `npm install`)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended | Confidence |
|------------|---------|---------|-----------------|------------|
| **Node.js** | >=20 LTS | Runtime | LTS with native fetch, stable ESM, performance.now(), AbortController -- all needed for proxy work. Node 20 is LTS through Apr 2026. Node 22 is current LTS. Either works. | HIGH |
| **TypeScript** | ~5.5+ | Language | Project constraint. Strict mode catches proxy-layer bugs (header types, response shapes). | HIGH |
| **Hono** | ^4.x | HTTP framework | Purpose-built for edge/proxy workloads. Native SSE streaming helpers, middleware composition, TypeScript-first, tiny footprint (~14KB). Runs on Node via `@hono/node-server`. Perfect for a proxy that needs to be fast and streaming-capable. | HIGH |
| **SQLite via better-sqlite3** | ^11.x | Persistence | Synchronous, zero-config, single-file database. Ideal for "lightweight persistence" constraint -- logs, stats, config all in one file. No daemon, no connection pooling. Ships inside Docker trivially. | HIGH |
| **React** | ^18.x or ^19.x | Web UI | Massive ecosystem, well-understood. Dashboard needs interactive state (chain reordering, live usage charts). React + Vite is the standard SPA approach. | HIGH |
| **Vite** | ^5.x or ^6.x | UI build tool | Fast HMR, native TypeScript, excellent DX. The build tool for any new React project in 2025/2026. | HIGH |

### HTTP / Proxy Layer Detail

| Library | Version | Purpose | Why | Confidence |
|---------|---------|---------|-----|------------|
| **hono** | ^4.x | Core HTTP framework | Lightweight, streaming-first, middleware-based. Has `hono/streaming` helper for SSE. Route composition is clean for mounting `/v1/chat/completions`, `/v1/completions`, etc. | HIGH |
| **@hono/node-server** | ^1.x | Node.js adapter for Hono | Hono is runtime-agnostic; this adapter runs it on Node with full streaming support. | HIGH |
| **undici** or **native fetch** | built-in (Node 20+) | Upstream HTTP client | Node 20+ ships with native fetch (built on undici). Use native fetch for upstream provider requests. No need for `node-fetch` or `axios`. Native fetch supports streaming `ReadableStream` natively, which is critical for SSE passthrough. | HIGH |
| **zod** | ^3.x | Schema validation | Validate incoming OpenAI-shaped requests, config files, provider definitions. TypeScript inference from schemas eliminates duplication. | HIGH |

### SSE Streaming Architecture

The SSE streaming layer is the most critical piece. Here is the recommended approach:

**Pattern: ReadableStream passthrough with transform**

```typescript
// Upstream provider returns a ReadableStream (from native fetch)
// Transform it to normalize SSE format, then pipe to client response

// Hono's streaming helper:
import { stream } from 'hono/streaming'

app.post('/v1/chat/completions', async (c) => {
  // ... chain resolution, provider selection ...

  const upstreamResponse = await fetch(providerUrl, {
    method: 'POST',
    headers: providerHeaders,
    body: JSON.stringify(transformedBody),
  })

  // For streaming responses, pipe through with transformation
  if (requestedStreaming) {
    return stream(c, async (stream) => {
      // Transform upstream SSE chunks to OpenAI-compatible format
      // Track token usage from chunks
      // On 429 from upstream, switch to next chain entry
    })
  }
})
```

**Key consideration:** The waterfall-on-429 behavior means you cannot just blindly pipe. You need to detect 429s _before_ starting to stream to the client. The proxy must:
1. Make the upstream request
2. Check the status code
3. If 429 or failure, try next provider (do NOT start streaming to client yet)
4. Once a provider responds with 200, THEN start streaming to client

This means the SSE passthrough is initiated only after provider selection succeeds. This is a clean pattern.

### Persistence Layer Detail

| Library | Version | Purpose | Why | Confidence |
|---------|---------|---------|-----|------------|
| **better-sqlite3** | ^11.x | SQLite driver | Synchronous API (no async overhead for simple queries), WAL mode for concurrent reads, battle-tested. Perfect for logs/stats persistence. | HIGH |
| **drizzle-orm** | ^0.36+ | ORM / query builder | Lightweight, TypeScript-native ORM. Schema-as-code, no code generation step, works beautifully with better-sqlite3. Much lighter than Prisma. Perfect for a project that wants typed queries without heavyweight tooling. | MEDIUM |
| **conf** or raw JSON | ^13.x / N/A | Config file management | For the `chains.json` / `providers.json` config files. Could use a simple JSON read/write utility. `conf` provides atomic writes and schema validation. Alternatively, just use `fs.readFileSync` + `JSON.parse` with Zod validation -- simpler, fewer deps. **Recommend: raw JSON + Zod.** | HIGH |

**Why SQLite over alternatives:**
- **vs. JSON files for logs:** JSON files grow unbounded, have no query capability, and are not concurrent-safe. SQLite handles all of this.
- **vs. LevelDB/RocksDB:** Overkill for this use case. SQLite has SQL query capability which is better for dashboard queries ("show me usage by provider for the last 7 days").
- **vs. PostgreSQL/MySQL:** Violates the "lightweight" constraint. Adds a daemon dependency, connection management, and Docker complexity.
- **vs. In-memory only:** Logs and stats need to survive restarts. SQLite in WAL mode is nearly as fast as in-memory for this workload.

### Web UI Detail

| Library | Version | Purpose | Why | Confidence |
|---------|---------|---------|-----|------------|
| **React** | ^18.x or ^19.x | UI framework | Standard choice. Component model fits the dashboard well (provider cards, chain editor, usage charts). | HIGH |
| **Vite** | ^5.x or ^6.x | Build tool / dev server | Fast builds, HMR, native TS. | HIGH |
| **TanStack Query** | ^5.x | Server state management | Handles API calls to the proxy's management endpoints. Caching, refetching, loading states all built-in. Dashboard will poll for live usage data -- TanStack Query makes this trivial. | HIGH |
| **Tailwind CSS** | ^3.x or ^4.x | Styling | Utility-first CSS. Fast to build dashboards. No design system overhead. Works great with copy-paste component libraries. | HIGH |
| **shadcn/ui** | N/A (copy-paste) | UI components | Not an npm package -- it is a component collection you copy into your project. Built on Radix UI + Tailwind. Provides tables, cards, forms, dialogs that a dashboard needs. Zero runtime dependency. | HIGH |
| **Recharts** | ^2.x | Charts | Usage charts, rate limit visualizations. React-native charting library. Simpler than D3, sufficient for dashboard charts. | MEDIUM |
| **@tanstack/react-table** | ^8.x | Data tables | Request log table, provider list. Headless, works with any UI. | MEDIUM |

**UI Serving Strategy:**

Build the React SPA with Vite. In production, the Hono server serves the built static files from a `/ui` or `/dashboard` route. In development, Vite dev server proxies API calls to the Hono server.

```
Production:
  Hono server
    /v1/*           -> proxy endpoints
    /api/*          -> management API
    /dashboard/*    -> static React SPA (built files)

Development:
  Vite dev server (port 5173) -> HMR for UI
    /api/* proxied to Hono (port 3429)
  Hono server (port 3429) -> API + proxy
```

### Supporting Libraries

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| **zod** | ^3.x | Validation | Everywhere: request validation, config parsing, env vars, API responses | HIGH |
| **pino** | ^9.x | Logging | Structured JSON logging. Fast, low-overhead. Use for proxy request logs, error tracking. | HIGH |
| **nanoid** | ^5.x | ID generation | Request IDs, chain IDs. Shorter than UUIDs, URL-safe, fast. | HIGH |
| **dotenv** | ^16.x | Environment variables | Load `.env` for API keys, port config. Or use Node 20+ `--env-file` flag instead. **Recommend: `--env-file` flag, skip dotenv dep.** | MEDIUM |
| **p-retry** | ^6.x | Retry logic | Wrap upstream fetch calls with exponential backoff. The waterfall logic itself is custom, but individual provider calls may benefit from brief retries on transient errors (not 429s -- those trigger waterfall). | LOW |
| **ms** | ^2.x | Time parsing | Parse "1m", "1h", "1d" for cooldown timers and rate limit windows. Tiny utility. | HIGH |
| **cron** or **node-cron** | latest | Scheduled tasks | Periodic cleanup of old logs, stats aggregation. Only needed if log volume is high. | LOW |

### Development Tools

| Tool | Purpose | Notes | Confidence |
|------|---------|-------|------------|
| **tsx** | TypeScript execution | Runs .ts files directly with esbuild. Use for development. Fast startup, no compilation step. Replaces `ts-node`. | HIGH |
| **tsup** | Build / bundle | esbuild-based bundler for the server-side code. Produces a clean `dist/` with CJS or ESM output. Simple config. | HIGH |
| **vitest** | Testing | Vite-native test runner. Fast, TypeScript-first, compatible with Jest API. Use for both server and UI tests. | HIGH |
| **eslint** | Linting | With `@typescript-eslint`. Standard. | HIGH |
| **prettier** | Formatting | Standard. | HIGH |
| **@types/better-sqlite3** | Type definitions | TypeScript types for better-sqlite3. | HIGH |
| **Docker** | Containerization | Multi-stage build: build UI + server, then slim runtime image. Node 20-slim base. | HIGH |

### Docker Strategy

```dockerfile
# Multi-stage build
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json .
RUN npm ci
COPY . .
RUN npm run build        # builds both server (tsup) and UI (vite)

FROM node:20-slim AS runtime
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json .
EXPOSE 3429
CMD ["node", "dist/server.js"]
```

SQLite database file mounts as a Docker volume at `/app/data/429chain.db`.

## Installation

```bash
# Core server
npm install hono @hono/node-server better-sqlite3 zod pino nanoid ms

# ORM (optional but recommended)
npm install drizzle-orm

# UI framework
npm install react react-dom @tanstack/react-query recharts

# Dev dependencies
npm install -D typescript tsx tsup vitest vite @vitejs/plugin-react
npm install -D tailwindcss postcss autoprefixer
npm install -D @types/node @types/react @types/react-dom @types/better-sqlite3
npm install -D eslint prettier @typescript-eslint/eslint-plugin @typescript-eslint/parser
npm install -D drizzle-kit  # if using drizzle
```

## Alternatives Considered

| Category | Recommended | Alternative | When to Use Alternative |
|----------|-------------|-------------|-------------------------|
| HTTP Framework | **Hono** | **Fastify** | If you need a more mature plugin ecosystem, or extensive middleware library. Fastify is heavier but has more battle-tested proxy plugins. Hono is better for this project because it is lighter, streaming-first, and the proxy logic is custom anyway. |
| HTTP Framework | **Hono** | **Express** | Never for a new project in 2025/2026. Express 5 has been in beta for years. Express 4 lacks native async/await, has poor TypeScript support, and streaming is clunky. |
| HTTP Framework | **Hono** | **Elysia (Bun)** | If you want Bun runtime instead of Node. Elysia is excellent but locks you into Bun. Node has broader deployment compatibility and better Docker support. |
| Persistence | **better-sqlite3** | **Prisma + SQLite** | If you want auto-generated migrations and a more ORM-like experience. But Prisma adds significant weight (binary engine), slow cold starts, and is overkill for this project's simple schema. |
| Persistence | **better-sqlite3** | **libsql / Turso** | If you want SQLite with replication or edge deployment. Unnecessary for a single-instance proxy. |
| Persistence | **better-sqlite3** | **LowDB** | If you want JSON-file persistence. LowDB is fine for config, but terrible for queryable logs/stats. Lacks indexing, filtering, aggregation. |
| UI | **React + Vite** | **Next.js** | If you wanted SSR. But the dashboard is a management UI served by the proxy itself -- SPA is the right model. Next.js adds enormous complexity and a separate server process. |
| UI | **React + Vite** | **Svelte + SvelteKit** | If team prefers Svelte. Valid choice, but React has larger component ecosystem (shadcn/ui, Recharts, TanStack) which accelerates dashboard development. |
| UI | **React + Vite** | **htmx + server templates** | If you want zero JS framework. Viable for a simple dashboard, but the chain editor (drag-to-reorder, live updates) and usage charts need client-side interactivity that htmx handles poorly. |
| ORM | **Drizzle** | **Kysely** | If you want a pure query builder without ORM abstractions. Kysely is excellent and lighter. Choose Drizzle for schema-as-code convenience; choose Kysely if you prefer writing SQL with type safety. |
| ORM | **Drizzle** | **Raw SQL via better-sqlite3** | If the schema is very simple (5-6 tables). Perfectly valid for v1. Drizzle adds convenience but also a dependency. **Honestly, raw SQL + better-sqlite3 is fine for this project.** |
| Charts | **Recharts** | **Chart.js + react-chartjs-2** | If you need more chart types. Recharts covers bar/line/area which is sufficient for usage dashboards. |
| Build | **tsup** | **esbuild directly** | If you want lower-level control. tsup is a thin wrapper around esbuild with sensible defaults. |
| Build | **tsup** | **unbuild** | If you need both CJS and ESM dual publishing. tsup handles this too, but unbuild is more focused on library publishing. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Express** | Outdated patterns, poor TypeScript support, no native streaming helpers, async error handling is broken by design. Express 5 has been "coming soon" for 5+ years. | **Hono** |
| **Axios** | Unnecessary weight. Does not support streaming ReadableStream well. Node 20+ native fetch does everything Axios does for this use case. | **Native fetch** |
| **node-fetch** | Polyfill for Node <18. Node 20+ has native fetch. Adding node-fetch is a pointless dependency. | **Native fetch** |
| **Prisma** | Heavy binary engine (~40MB), slow cold starts, overkill ORM for 5 tables. Adds significant Docker image size. | **better-sqlite3 + Drizzle** (or raw SQL) |
| **MongoDB** | "Lightweight persistence" means SQLite, not a database daemon. MongoDB requires a separate process, connection management, and is wildly inappropriate for this workload. | **SQLite** |
| **Redis** | Tempting for rate limit tracking, but adds a daemon dependency. In-memory Map + SQLite for persistence covers the same need without ops overhead. For a single-instance proxy, Redis adds complexity for zero benefit. | **In-memory Map + SQLite** |
| **Socket.io** | Tempting for live dashboard updates, but SSE (EventSource) is simpler, lighter, and sufficient for one-way server-to-client push. The dashboard only needs to receive updates, not send them via websocket. | **SSE via Hono streaming** or **polling via TanStack Query** |
| **Next.js** | Adds a full server framework when you already have one (Hono). The dashboard is a management SPA, not a marketing site. Next.js SSR/SSG is irrelevant. It would complicate the build, double the server processes, and add massive dependency weight. | **React + Vite (SPA)** |
| **Webpack** | Slow, complex configuration. Vite replaced it for new projects. | **Vite** |
| **ts-node** | Slow startup, problematic ESM support. tsx (based on esbuild) is faster and simpler. | **tsx** |
| **Jest** | Slow, complex configuration with TypeScript. Vitest is API-compatible but faster and natively supports TypeScript. | **Vitest** |
| **dotenv** | Node 20.6+ supports `--env-file=.env` flag natively. One fewer dependency. | **Node --env-file flag** |
| **class-validator / class-transformer** | Decorator-based validation is verbose and ties you to classes. Zod is more ergonomic, works with plain objects, and infers TypeScript types. | **Zod** |
| **Sequelize** | Heavy, old-school ORM. Poor TypeScript support. | **Drizzle** or raw SQL |

## Project Structure Recommendation

```
429chain/
  src/
    server/              # Hono server + proxy logic
      index.ts           # Entry point, creates Hono app
      proxy/
        handler.ts       # /v1/chat/completions, /v1/completions handlers
        stream.ts        # SSE streaming transform + passthrough
        waterfall.ts     # Chain resolution + 429 waterfall logic
      providers/
        registry.ts      # Provider definitions, API key management
        adapters/        # Per-provider request/response transforms
          openrouter.ts
          groq.ts
          cerebras.ts
      ratelimit/
        tracker.ts       # In-memory rate limit state
        headers.ts       # Parse x-ratelimit-* headers
        cooldown.ts      # Cooldown timer management
      api/
        chains.ts        # CRUD for chain configurations
        providers.ts     # CRUD for provider configurations
        stats.ts         # Usage stats endpoints
        auth.ts          # API key validation middleware
      db/
        schema.ts        # Drizzle schema or raw SQL DDL
        migrations/      # Schema migrations
        index.ts         # Database connection
      config/
        index.ts         # Config loading, validation, defaults
        schema.ts        # Zod schemas for config files
      middleware/
        auth.ts          # API key check
        logging.ts       # Request/response logging
        error.ts         # Error handling
    ui/                  # React SPA (Vite)
      src/
        App.tsx
        pages/
          Dashboard.tsx
          Chains.tsx
          Providers.tsx
          TestEndpoint.tsx
        components/
        hooks/
        api/             # TanStack Query hooks for management API
      index.html
      vite.config.ts
      tailwind.config.ts
  data/                  # SQLite DB file (gitignored)
  config/                # Default config files
    chains.example.json
    providers.example.json
  Dockerfile
  docker-compose.yml
  package.json
  tsconfig.json
  tsup.config.ts
```

## Monorepo vs Single Package

**Recommendation: Single package with workspaces is unnecessary for v1.**

The project has two build outputs (server bundle + UI static files), but they share a single `package.json`. Use tsup for the server build and Vite for the UI build. A simple `npm run build` script runs both.

If the project grows significantly, consider splitting into `packages/server` and `packages/ui` with npm workspaces. But for v1, the overhead is not justified.

## Version Compatibility Notes

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| Hono ^4.x | Node >= 18 | Uses Web Standard APIs (Request, Response, ReadableStream) |
| better-sqlite3 ^11.x | Node >= 18 | Native addon, needs node-gyp. Pre-built binaries available for common platforms. |
| Drizzle ORM | better-sqlite3 ^9+ | Uses `drizzle-orm/better-sqlite3` adapter |
| Vite ^5.x / ^6.x | Node >= 18 | |
| React ^18.x / ^19.x | Vite ^5+ | React 19 may have breaking changes with some libraries -- verify component library compatibility |
| TanStack Query ^5.x | React ^18+ | |
| Tailwind ^4.x | Vite ^5+ | Tailwind v4 changed config format (CSS-based instead of JS). Verify shadcn/ui compatibility. If issues, use Tailwind ^3.x. |
| tsx | Node >= 18 | |
| tsup | Node >= 18 | |

**IMPORTANT version caveat:** The versions above are based on my training data cutoff (May 2025). Before running `npm install`, verify latest stable versions:
- Check `npm view <package> version` for each package
- Check changelogs for breaking changes since May 2025
- Tailwind v4 and React 19 are the most likely to have had breaking changes

## Key Architecture Decision: OpenAI SDK Compatibility

The proxy must accept requests in OpenAI's format and return responses in OpenAI's format, including SSE streaming. The critical endpoints are:

```
POST /v1/chat/completions    # Chat completion (most important)
POST /v1/completions         # Text completion (legacy but some tools use it)
GET  /v1/models              # List available models (from configured chains)
```

**SSE format must match OpenAI exactly:**
```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"},"index":0}]}

data: [DONE]
```

Each upstream provider (OpenRouter, Groq, Cerebras) already speaks OpenAI-compatible format since they all offer OpenAI-compatible endpoints. This simplifies the proxy significantly -- the main transformation is URL and auth header rewriting, not response format conversion.

## Rate Limit Tracking Strategy (Stack Implications)

Rate limits are tracked in-memory (Map/object) for speed, persisted to SQLite for restart recovery.

```typescript
// In-memory structure
interface ProviderRateState {
  rpm: { remaining: number; resetsAt: number }
  daily: { remaining: number; resetsAt: number }
  concurrent: { active: number; limit: number }
  cooldownUntil: number | null  // Set on 429, cleared on reset
}

// Updated from:
// 1. Response headers (x-ratelimit-remaining, x-ratelimit-reset)
// 2. Manual config (user sets RPM=20 for provider X)
// 3. 429 responses (set cooldown timer)
```

No Redis needed. No external cache. A simple Map with periodic SQLite snapshots.

## Sources

- Hono documentation: https://hono.dev (framework features, streaming, Node.js adapter)
- better-sqlite3 documentation: https://github.com/WiseLibs/better-sqlite3 (API, WAL mode, performance)
- Drizzle ORM documentation: https://orm.drizzle.team (SQLite adapter, schema definition)
- Vite documentation: https://vitejs.dev (build tool, React plugin)
- TanStack Query documentation: https://tanstack.com/query (server state management)
- OpenAI API reference: https://platform.openai.com/docs/api-reference (endpoint shapes, SSE format)
- shadcn/ui: https://ui.shadcn.com (component library approach)
- Zod documentation: https://zod.dev (schema validation)
- Pino documentation: https://getpino.io (structured logging)

**Source confidence note:** All sources are from my training data (cutoff May 2025). I was unable to access WebSearch or WebFetch to verify current versions and latest developments. All version numbers should be verified before installation. The architectural recommendations and library choices are HIGH confidence -- these are well-established tools that are unlikely to have been superseded in the 9 months since my training cutoff.

---
*Stack research for: AI inference proxy/aggregator (429chain)*
*Researched: 2026-02-05*
*Researcher confidence: MEDIUM overall (HIGH on architecture/patterns, MEDIUM on exact versions)*
