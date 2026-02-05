# Architecture Research

**Domain:** AI inference proxy/aggregator
**Researched:** 2026-02-05
**Confidence:** MEDIUM (based on training knowledge of LiteLLM, Portkey Gateway, and proxy design patterns; unable to verify against live sources due to tool unavailability)

## Standard Architecture

### System Overview

AI inference proxies follow a layered gateway pattern. The system sits between callers (any OpenAI SDK client) and upstream AI providers. This is architecturally similar to an API gateway or reverse proxy, but specialized for LLM inference with streaming, token accounting, and intelligent failover.

```
                            429chain System
 +-----------------------------------------------------------------+
 |                                                                   |
 |  Callers          API Layer        Core Engine       Providers    |
 |  (OpenAI SDK)                                                     |
 |                 +-------------+  +---------------+                |
 |   POST /v1/ -->| Auth        |->| Chain Router  |---> OpenRouter  |
 |   chat/       | Middleware   |  |               |                |
 |   completions | OpenAI      |  | +----------+  |---> Groq        |
 |               | Compat Layer|  | | Rate Limit|  |                |
 |   SSE <------| SSE Bridge   |<-| | Tracker   |  |---> Cerebras   |
 |               +-------------+  | +----------+  |                |
 |                                |               |---> [Provider N]|
 |                 +-------------+  | +----------+  |                |
 |   Browser ---->| Web UI      |  | | Cooldown  |  |                |
 |               | (Dashboard) |  | | Manager   |  |                |
 |               +-------------+  | +----------+  |                |
 |                                +---------------+                |
 |                                      |                           |
 |                              +---------------+                   |
 |                              | Persistence   |                   |
 |                              | (Config + Log)|                   |
 |                              +---------------+                   |
 +-----------------------------------------------------------------+
```

### Layered Architecture

The system has five distinct layers, each with clear boundaries:

```
+----------------------------------------------------------+
|  Layer 1: HTTP Surface (Express/Fastify)                  |
|  - OpenAI-compatible endpoints                            |
|  - API key authentication middleware                      |
|  - Request validation                                     |
|  - SSE response management                                |
|  - Web UI static file serving + API routes                |
+----------------------------------------------------------+
         |                              ^
         v                              |
+----------------------------------------------------------+
|  Layer 2: Request Orchestration                           |
|  - Chain resolution (which chain for this request?)       |
|  - Waterfall execution loop                               |
|  - Retry/timeout logic                                    |
|  - Response normalization                                 |
+----------------------------------------------------------+
         |                              ^
         v                              |
+----------------------------------------------------------+
|  Layer 3: Provider Intelligence                           |
|  - Rate limit tracking (proactive + reactive)             |
|  - Cooldown timers per provider+model                     |
|  - Provider availability scoring                          |
|  - Header parsing for rate limit info                     |
+----------------------------------------------------------+
         |                              ^
         v                              |
+----------------------------------------------------------+
|  Layer 4: Provider Adapters                               |
|  - HTTP client per provider                               |
|  - Request translation (OpenAI -> provider format)        |
|  - Response translation (provider -> OpenAI format)       |
|  - SSE stream passthrough/transformation                  |
|  - Header extraction (rate limit headers)                 |
+----------------------------------------------------------+
         |                              ^
         v                              |
+----------------------------------------------------------+
|  Layer 5: Persistence & Config                            |
|  - Config file read/write (YAML or JSON)                  |
|  - Usage/stats logging                                    |
|  - Request history                                        |
|  - In-memory state with periodic flush                    |
+----------------------------------------------------------+
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **HTTP Server** | Accept OpenAI-format requests, serve Web UI | Express or Fastify with middleware stack |
| **Auth Middleware** | Validate proxy API keys on incoming requests | Middleware that checks `Authorization: Bearer` header against configured keys |
| **OpenAI Compat Layer** | Validate request shape, ensure OpenAI-format responses | Request/response schemas matching OpenAI's chat/completions spec |
| **Chain Router** | Select which chain to use, execute waterfall logic | Core orchestrator that iterates through chain entries |
| **Rate Limit Tracker** | Track remaining capacity per provider+model | In-memory map updated from response headers and 429 events |
| **Cooldown Manager** | Temporarily exclude exhausted providers | Timer-based system that marks providers unavailable until reset |
| **Provider Adapter** | Translate between OpenAI format and provider-specific APIs | Adapter pattern -- one adapter per provider type |
| **SSE Bridge** | Stream upstream SSE responses back to caller | Transform/passthrough upstream `text/event-stream` to client |
| **Usage Tracker** | Count tokens, requests, latency per provider and chain | Event-driven collector aggregating metrics |
| **Config Manager** | Load/save/validate configuration | File-based config with in-memory cache, exposed via Web UI API |
| **Web UI Backend** | REST API for dashboard operations | Express routes for CRUD on providers, chains, viewing stats |
| **Web UI Frontend** | Browser-based management dashboard | React/Vue SPA or lightweight vanilla JS served as static files |
| **Persistence Layer** | Durable storage for config, logs, stats | JSON/YAML files, SQLite for logs if needed |

## Recommended Project Structure

```
src/
├── index.ts                    # Entry point: bootstrap server
├── server.ts                   # HTTP server setup (Express/Fastify)
│
├── api/                        # Layer 1: HTTP Surface
│   ├── routes/
│   │   ├── chat.ts             # POST /v1/chat/completions (the core proxy endpoint)
│   │   ├── models.ts           # GET /v1/models (list available models/chains)
│   │   └── health.ts           # GET /health
│   ├── middleware/
│   │   ├── auth.ts             # API key validation
│   │   ├── validate.ts         # Request body validation
│   │   └── error-handler.ts    # Global error handling
│   └── admin/
│       ├── providers.ts        # CRUD for provider configurations
│       ├── chains.ts           # CRUD for chain configurations
│       ├── stats.ts            # Usage statistics endpoints
│       └── test.ts             # Test endpoint (send prompt, see routing)
│
├── core/                       # Layer 2: Request Orchestration
│   ├── chain-router.ts         # Chain selection + waterfall execution
│   ├── request-context.ts      # Per-request context object (timing, attempts, etc.)
│   └── response-builder.ts     # Normalize responses to OpenAI format
│
├── providers/                  # Layer 3+4: Provider Intelligence & Adapters
│   ├── registry.ts             # Provider registry (available providers)
│   ├── base-adapter.ts         # Abstract base class for provider adapters
│   ├── adapters/
│   │   ├── openrouter.ts       # OpenRouter-specific adapter
│   │   ├── groq.ts             # Groq-specific adapter
│   │   ├── cerebras.ts         # Cerebras-specific adapter
│   │   └── generic-openai.ts   # Generic OpenAI-compatible adapter (fallback)
│   └── rate-limit/
│       ├── tracker.ts          # Rate limit state machine per provider+model
│       ├── header-parser.ts    # Parse x-ratelimit-* headers from responses
│       ├── cooldown.ts         # Cooldown timer management
│       └── types.ts            # Rate limit data types
│
├── streaming/                  # SSE handling
│   ├── sse-bridge.ts           # Pipe upstream SSE to downstream client
│   ├── sse-parser.ts           # Parse SSE events from upstream
│   └── sse-writer.ts           # Write SSE events to client response
│
├── tracking/                   # Usage tracking & metrics
│   ├── usage-collector.ts      # Event-driven usage data collection
│   ├── aggregator.ts           # Roll up stats per provider, chain, time window
│   └── request-log.ts          # Request-level logging
│
├── config/                     # Layer 5: Configuration & Persistence
│   ├── manager.ts              # Load/save/watch config files
│   ├── schema.ts               # Config validation schemas (Zod)
│   ├── defaults.ts             # Default configuration values
│   └── types.ts                # Config type definitions
│
├── persistence/                # Storage abstraction
│   ├── store.ts                # Abstract storage interface
│   ├── json-store.ts           # JSON file-based implementation
│   └── sqlite-store.ts         # Optional SQLite for request logs (future)
│
├── ui/                         # Web UI
│   └── (built frontend assets, served statically)
│
└── shared/                     # Cross-cutting concerns
    ├── types.ts                # Shared type definitions
    ├── errors.ts               # Custom error classes
    ├── logger.ts               # Structured logging
    └── events.ts               # Event bus for decoupled communication
```

### Structure Rationale

**Why this separation:**

1. **`api/` vs `core/` boundary:** The API layer handles HTTP concerns (parsing, auth, response formatting). The core layer handles business logic (chain resolution, waterfall). This means you could theoretically swap Express for Fastify without touching core logic.

2. **`providers/` encapsulates provider knowledge:** Each provider adapter knows how to translate requests and extract rate limit information. The core chain router does not need to know provider-specific details -- it just calls `adapter.complete(request)` and gets an OpenAI-format response.

3. **`streaming/` is its own concern:** SSE handling is complex enough to warrant isolation. The SSE bridge must handle backpressure, error mid-stream, partial chunks, and clean termination. Keeping this separate from provider adapters prevents duplication.

4. **`tracking/` is event-driven:** Usage collection is a side effect, not part of the critical request path. Using an event bus (`shared/events.ts`) lets the chain router emit events that the tracker consumes without coupling.

5. **`config/` vs `persistence/`:** Config is structured, validated, and cached in memory. Persistence is generic storage. Config uses persistence, but persistence could also store logs, stats, etc.

6. **`shared/` for cross-cutting:** Types, errors, and the event bus are used across all layers. They live in a shared directory to avoid circular dependencies.

## Architectural Patterns

### Pattern 1: Chain of Responsibility (Waterfall Execution)

The core routing pattern. A request walks through an ordered chain of provider+model entries. Each entry either handles the request or passes it to the next.

**Why this pattern:** It maps directly to the "waterfall" requirement. The chain is an ordered list; each entry is tried in sequence. Unlike load balancing (which distributes), waterfall is strictly ordered with fallback semantics.

```typescript
// Conceptual chain execution
interface ChainEntry {
  providerId: string;
  modelId: string;
  priority: number;  // position in chain
}

interface Chain {
  id: string;
  name: string;
  entries: ChainEntry[];
}

async function executeChain(
  chain: Chain,
  request: ChatCompletionRequest,
  context: RequestContext
): Promise<ChatCompletionResponse | ReadableStream> {

  for (const entry of chain.entries) {
    // Check: is this entry available?
    if (rateLimitTracker.isExhausted(entry.providerId, entry.modelId)) {
      context.log(`Skipping ${entry.providerId}/${entry.modelId}: rate limited`);
      continue; // proactive skip
    }

    try {
      const adapter = providerRegistry.getAdapter(entry.providerId);
      const result = await adapter.complete(entry.modelId, request);

      // Update rate limit state from response headers
      rateLimitTracker.update(entry.providerId, entry.modelId, result.headers);

      // Track usage
      events.emit('request:success', { entry, request, result, context });

      return result.body; // success -- return to caller
    } catch (error) {
      if (is429(error) || isProviderError(error)) {
        // Mark as exhausted, set cooldown
        rateLimitTracker.markExhausted(entry.providerId, entry.modelId, error);
        context.log(`${entry.providerId}/${entry.modelId} failed: ${error.status}`);

        events.emit('request:fallback', { entry, error, context });
        continue; // try next entry in chain
      }
      throw error; // unexpected error, don't waterfall
    }
  }

  // All entries exhausted
  throw new AllProvidersExhaustedError(chain.id, context.attempts);
}
```

**Key design decision:** Proactive skipping (checking rate limit state before attempting) is important for performance. Without it, every request would sequentially hit rate-limited providers and wait for 429 responses, adding latency.

### Pattern 2: Adapter Pattern (Provider Abstraction)

Each AI provider has slightly different API shapes, auth methods, rate limit headers, and streaming formats. The adapter pattern normalizes this.

```typescript
abstract class BaseProviderAdapter {
  abstract readonly providerId: string;

  // Core method: send a completion request
  abstract complete(
    modelId: string,
    request: ChatCompletionRequest,
    options: { stream: boolean }
  ): Promise<ProviderResponse>;

  // Parse rate limit headers from this provider's response
  abstract parseRateLimitHeaders(headers: Headers): RateLimitInfo | null;

  // Map provider-specific error to standard error
  abstract normalizeError(error: unknown): ProviderError;

  // List available models (for UI)
  abstract listModels(): Promise<ModelInfo[]>;
}
```

**Why needed:** Even among "OpenAI-compatible" providers, there are differences:
- OpenRouter uses `HTTP-Referer` and `X-Title` headers
- Groq has specific rate limit header formats
- Some providers use different SSE chunk formats
- Auth header formats can vary (Bearer vs custom)

The generic-openai adapter handles 80% of cases (any provider with a standard OpenAI-compatible endpoint), while specific adapters handle provider quirks.

### Pattern 3: Event-Driven Side Effects

Usage tracking, logging, and metrics should not be in the critical request path. An event bus decouples these.

```typescript
// Event bus (simple typed EventEmitter)
const events = new TypedEventEmitter<{
  'request:start':    { chain: Chain, request: ChatCompletionRequest, context: RequestContext };
  'request:success':  { entry: ChainEntry, result: ProviderResponse, context: RequestContext };
  'request:fallback': { entry: ChainEntry, error: ProviderError, context: RequestContext };
  'request:failed':   { chain: Chain, context: RequestContext };
  'ratelimit:update': { providerId: string, modelId: string, info: RateLimitInfo };
  'ratelimit:exhausted': { providerId: string, modelId: string, cooldownMs: number };
}>();

// Usage tracking subscribes to events
events.on('request:success', (data) => {
  usageCollector.recordSuccess(data);
});

events.on('request:fallback', (data) => {
  usageCollector.recordFallback(data);
});
```

**Why this matters:** If usage tracking throws an error or is slow, it should never affect the caller's response. Events make this naturally isolated.

### Pattern 4: SSE Passthrough with Interception

Streaming is the most architecturally complex piece. The proxy must:
1. Open an SSE connection upstream to the provider
2. Pipe chunks downstream to the caller
3. Intercept chunks for token counting (the final chunk contains usage data)
4. Handle mid-stream errors (provider dies mid-response)
5. Handle mid-stream 429 (rare but possible with some providers)

```
Caller <--SSE-- [SSE Bridge] <--SSE-- Provider
                     |
                     +--> Token counter (intercepts final chunk)
                     +--> Error handler (detects mid-stream failure)
```

**Critical decision: What happens when streaming fails mid-response?**

Options:
- **A) Send error event in SSE stream, caller handles it.** This is the standard approach. The OpenAI SSE format supports error events. Callers must handle partial responses.
- **B) Buffer the entire response, only send when complete.** Defeats the purpose of streaming. Do not do this.
- **C) Transparent retry with a new provider mid-stream.** Extremely complex, requires buffering sent chunks and replaying context. Not worth it for v1.

**Recommendation: Option A.** Send an SSE error event if a provider fails mid-stream. For non-streaming requests, waterfall retry is automatic (the response hasn't been sent yet).

### Pattern 5: Rate Limit State Machine

Each provider+model pair has a rate limit state:

```
                   +-----------+
         ------->  | AVAILABLE |  <-- initial state
        |          +-----------+
        |               |
        |     response headers OR 429
        |               |
        |               v
        |    +-------------------+
        |    | TRACKING          |  <-- headers parsed, remaining > 0
        |    | remaining: N      |
        |    | resets_at: T      |
        |    +-------------------+
        |               |
        |        remaining == 0 OR 429 received
        |               |
        |               v
        |    +-------------------+
        +----| EXHAUSTED         |  <-- cooldown active
             | cooldown_until: T |
             +-------------------+
                     |
              timer expires (cooldown_until reached)
                     |
                     v
              back to AVAILABLE
```

Rate limit information sources (in priority order):
1. **Response headers** (proactive): `x-ratelimit-remaining`, `x-ratelimit-reset` -- most reliable
2. **429 response headers** (reactive): Often include `retry-after` or reset time
3. **Manual config** (fallback): User-specified RPM, daily token caps
4. **Learned patterns** (heuristic): If a provider consistently 429s at ~60 RPM, learn that threshold

## Data Flow

### Request Flow (Non-Streaming)

```
Client                  429chain                              Provider A    Provider B
  |                        |                                      |             |
  |-- POST /v1/chat/completions (OpenAI format) -->|              |             |
  |                        |                                      |             |
  |                   [Auth middleware]                            |             |
  |                   [Validate request]                          |             |
  |                   [Resolve chain]                             |             |
  |                        |                                      |             |
  |                   [Check rate limit: Provider A]               |             |
  |                   [Status: AVAILABLE]                          |             |
  |                        |                                      |             |
  |                        |-- POST /chat/completions ----------->|             |
  |                        |                                      |             |
  |                        |<---------- 429 Too Many Requests ----|             |
  |                        |                                      |             |
  |                   [Mark Provider A EXHAUSTED]                  |             |
  |                   [Parse retry-after header]                   |             |
  |                   [Set cooldown timer]                         |             |
  |                        |                                      |             |
  |                   [Check rate limit: Provider B]               |             |
  |                   [Status: AVAILABLE]                          |             |
  |                        |                                      |             |
  |                        |-- POST /chat/completions ----------------------->|
  |                        |                                                  |
  |                        |<---------- 200 OK (completion response) ---------|
  |                        |                                                  |
  |                   [Parse rate limit headers from Provider B]              |
  |                   [Update tracker: remaining=47, resets_at=...]           |
  |                   [Emit: request:success event]                          |
  |                   [Normalize to OpenAI format]                           |
  |                        |                                                  |
  |<-- 200 OK (OpenAI format response) ---|                                  |
  |                        |                                                  |
```

### Request Flow (Streaming)

```
Client                  429chain                              Provider
  |                        |                                      |
  |-- POST /v1/chat/completions { stream: true } -->|             |
  |                        |                                      |
  |                   [Auth + Validate + Resolve chain]           |
  |                   [Find available provider (skip exhausted)]  |
  |                        |                                      |
  |                        |-- POST /chat/completions stream=true->|
  |                        |                                      |
  |                        |<-- 200 OK text/event-stream ---------|
  |                        |                                      |
  |<-- 200 OK text/event-stream --|                               |
  |                        |                                      |
  |                        |<-- data: {"choices":[...]} ----------|
  |<-- data: {"choices":[...]} ---|  (piped through SSE bridge)   |
  |                        |                                      |
  |                        |<-- data: {"choices":[...]} ----------|
  |<-- data: {"choices":[...]} ---|                               |
  |                        |                                      |
  |                        |<-- data: [DONE] + usage in final ----|
  |<-- data: [DONE] --------------|                               |
  |                        |                                      |
  |                   [Extract usage from final chunk]            |
  |                   [Update rate limit tracker]                 |
  |                   [Emit: request:success]                     |
```

**Important streaming detail:** The response headers (including `Content-Type: text/event-stream` and status code) must be sent to the caller BEFORE the first chunk arrives from the provider. This means once streaming starts, you cannot waterfall to another provider -- the HTTP response is already committed. Therefore:

**Non-streaming requests** can waterfall freely (no response sent yet).
**Streaming requests** must validate provider availability BEFORE opening the stream. If a streaming request fails mid-stream, send an SSE error event; do not attempt to silently switch providers.

However, if a streaming request gets a non-200 response (like 429) before any chunks are sent, you CAN waterfall -- the stream hasn't started yet.

### State Management

```
+------------------------------------------+
|           In-Memory State                |
|                                           |
|  Rate Limit Map                          |
|  Map<"providerId:modelId", {              |
|    state: AVAILABLE | TRACKING | EXHAUSTED|
|    remaining: number | null               |
|    resetsAt: Date | null                  |
|    cooldownUntil: Date | null             |
|    dailyTokensUsed: number                |
|    dailyTokenLimit: number | null         |
|    rpm: { count: number, windowStart }    |
|  }>                                       |
|                                           |
|  Active Cooldown Timers                  |
|  Map<"providerId:modelId", NodeJS.Timer>  |
|                                           |
|  Usage Counters (current session)        |
|  Map<key, { requests, tokens, errors }>   |
+------------------------------------------+
         |                    ^
         | periodic flush     | load on startup
         v                    |
+------------------------------------------+
|           Persistent Storage             |
|                                           |
|  config.yaml (or config.json)            |
|  - providers: [{ id, name, apiKey, ... }]|
|  - chains: [{ id, name, entries: [...] }]|
|  - settings: { port, apiKeys, ... }      |
|                                           |
|  data/usage.json                         |
|  - daily aggregates per provider/chain   |
|  - rolling request log (last N entries)  |
|                                           |
|  data/ratelimits.json                    |
|  - persisted rate limit state for        |
|    recovery after restart                |
+------------------------------------------+
```

**Key state design decisions:**

1. **Rate limit state is primarily in-memory.** It changes on every request. Persisting to disk on every request would be a performance bottleneck. Instead, persist periodically (every 30s or on shutdown) so state survives restarts.

2. **Config is file-based but cached in memory.** The config manager loads config on startup, keeps it in memory, and writes back when changes are made via the Web UI. This avoids filesystem reads on every request.

3. **Usage data is append-friendly.** Request logs grow over time. Use a rolling log (keep last N entries or last N days) to prevent unbounded growth. Aggregated stats (daily totals) are separate and compact.

## Scaling Considerations

| Concern | At 1-10 RPS (personal use) | At 100 RPS (team) | At 1000+ RPS (public service) |
|---------|---------------------------|--------------------|-----------------------------|
| **Concurrency** | Single Node process sufficient | Single process OK, may need worker threads for CPU-bound token counting | Cluster mode or multiple instances with shared state |
| **State** | In-memory is fine | In-memory is fine | Need shared state store (Redis) across instances |
| **Persistence** | JSON files sufficient | JSON files OK, consider SQLite for request logs | Need proper database (Postgres) |
| **Streaming** | No concerns | Monitor open connection count | Need connection pooling, backpressure management |
| **Rate Limit Tracking** | In-memory map | In-memory map | Shared Redis-based tracking |

**For v1 (personal/small team use):** Single-process, in-memory state, JSON file persistence is the right choice. Do not over-engineer. The architecture allows swapping the persistence layer later without touching core logic.

## Anti-Patterns

### Anti-Pattern 1: Monolithic Request Handler

**What:** Putting all logic (auth, routing, provider calls, streaming, tracking) in a single route handler function.

**Why bad:** A 500-line route handler is impossible to test, debug, or extend. Adding a new provider means modifying the core handler.

**Instead:** Layer the architecture as described above. The route handler should be ~20 lines: validate, call chain router, return response. Everything else is delegated.

### Anti-Pattern 2: Synchronous Rate Limit Checks Against Disk

**What:** Reading rate limit state from a JSON file on every incoming request.

**Why bad:** File I/O on every request adds latency and creates a bottleneck. Under concurrent requests, file reads can return stale data.

**Instead:** Keep rate limit state in memory. Flush to disk periodically for crash recovery. Memory reads are effectively free.

### Anti-Pattern 3: Buffering Full Streaming Responses

**What:** Collecting all SSE chunks into a buffer, then sending the complete response to the caller.

**Why bad:** Defeats the purpose of streaming. Users see no output until the entire response is generated (could be 10+ seconds for long completions). Also doubles memory usage.

**Instead:** Pipe chunks through as they arrive. Only intercept/inspect chunks for metadata (token counts in final chunk), do not buffer them.

### Anti-Pattern 4: Hard-Coding Provider Logic

**What:** Having `if (provider === 'openrouter') { ... } else if (provider === 'groq') { ... }` throughout the codebase.

**Why bad:** Adding a new provider requires changes in multiple files. Easy to miss one branch and introduce bugs.

**Instead:** Provider adapter pattern. Each provider is a class implementing a common interface. The core system works with the interface, never with concrete providers directly. New providers are added by implementing the interface.

### Anti-Pattern 5: Tight Coupling Between Proxy and Dashboard

**What:** Building the Web UI backend and the proxy API as intertwined route handlers sharing state via module globals.

**Why bad:** Makes it impossible to test the proxy without the UI, or vice versa. State management becomes a tangled mess.

**Instead:** The proxy (API layer + core) and the dashboard (admin API + frontend) share state only through well-defined interfaces: the config manager, the rate limit tracker, and the usage collector. They are separate route modules mounted on the same HTTP server.

### Anti-Pattern 6: Retry Loops Without Circuit Breaking

**What:** On every 429, immediately retry with the same provider after a delay.

**Why bad:** If a provider is rate-limited for 60 seconds, retrying every second wastes 60 requests. Multiply by concurrent callers and you're DDoS-ing the provider.

**Instead:** Mark as EXHAUSTED with a cooldown. Skip it entirely until the cooldown expires. This is what the rate limit state machine provides.

## Integration Points

### External Services (AI Providers)

| Provider | Base URL | Auth Pattern | Rate Limit Headers | Notes |
|----------|----------|-------------|-------------------|-------|
| OpenRouter | `https://openrouter.ai/api/v1` | Bearer token + HTTP-Referer | `x-ratelimit-remaining`, `x-ratelimit-limit`, `x-ratelimit-reset` | Many free models, popular aggregator |
| Groq | `https://api.groq.com/openai/v1` | Bearer token | `x-ratelimit-remaining-requests`, `x-ratelimit-remaining-tokens`, `retry-after` | Very fast inference, strict rate limits |
| Cerebras | `https://api.cerebras.ai/v1` | Bearer token | Standard x-ratelimit headers | Fast inference, free tier |
| Generic OpenAI-compatible | Configurable | Bearer token | Variable | Catch-all for any provider using OpenAI API format |

**Provider integration contract:**
- All providers are accessed via HTTP POST to a `/chat/completions` endpoint
- All use `Authorization: Bearer <key>` (with minor variations)
- Response format should be OpenAI-compatible (though some providers add extra fields)
- SSE format follows OpenAI's `data: {json}\n\n` pattern
- Rate limit headers are provider-specific and need per-provider parsing

### Internal Boundaries

```
                    Config Manager
                    /     |      \
                   /      |       \
            Chain Router  |   Rate Limit Tracker
                |         |         |
                |    Usage Collector |
                |         |         |
            Provider -----+---------+
            Adapters
                |
            SSE Bridge
```

**Boundary rules:**

1. **Chain Router -> Provider Adapters:** Router calls adapters through the registry interface. Router never imports a specific adapter.

2. **Chain Router -> Rate Limit Tracker:** Router queries tracker to check availability. Tracker never initiates requests.

3. **Provider Adapters -> Rate Limit Tracker:** Adapters parse headers and send updates to tracker. Tracker does not know about HTTP.

4. **Usage Collector -> Everything:** Collector listens to events. Nothing depends on the collector. It can be disabled without affecting functionality.

5. **Config Manager -> Everything:** Config is injected at startup. Components read config, they do not own it.

6. **Web UI Backend -> Core Components:** The admin API reads from Config Manager, Rate Limit Tracker, and Usage Collector. It writes to Config Manager only. It never directly interacts with Provider Adapters.

### Build Order Dependencies

Understanding what depends on what is critical for phasing the build:

```
Level 0 (no dependencies):
  - shared/types.ts
  - shared/errors.ts
  - shared/logger.ts
  - shared/events.ts
  - config/schema.ts
  - config/types.ts

Level 1 (depends on Level 0):
  - config/manager.ts (depends on types, schema)
  - persistence/store.ts (depends on types)
  - providers/base-adapter.ts (depends on types, errors)
  - providers/rate-limit/types.ts (depends on shared types)

Level 2 (depends on Level 1):
  - providers/rate-limit/tracker.ts (depends on rate-limit types, events)
  - providers/rate-limit/header-parser.ts (depends on rate-limit types)
  - providers/rate-limit/cooldown.ts (depends on tracker, events)
  - providers/adapters/generic-openai.ts (depends on base-adapter)
  - streaming/sse-parser.ts (depends on types)
  - streaming/sse-writer.ts (depends on types)

Level 3 (depends on Level 2):
  - providers/registry.ts (depends on adapters, config)
  - streaming/sse-bridge.ts (depends on parser, writer)
  - tracking/usage-collector.ts (depends on events, types)

Level 4 (depends on Level 3):
  - core/chain-router.ts (depends on registry, tracker, sse-bridge, events)
  - core/request-context.ts (depends on types)
  - core/response-builder.ts (depends on types)

Level 5 (depends on Level 4):
  - api/middleware/* (depends on config, types)
  - api/routes/chat.ts (depends on chain-router, response-builder)
  - api/routes/models.ts (depends on config, registry)

Level 6 (depends on Level 5):
  - api/admin/* (depends on config, tracker, usage-collector)
  - server.ts (depends on all routes)

Level 7 (depends on Level 6):
  - Web UI frontend (depends on admin API being stable)
```

**Implied phase ordering for roadmap:**
1. **Foundation:** Types, config schema, error classes, logger, event bus
2. **Provider Layer:** Base adapter, generic OpenAI adapter, header parser
3. **Core Engine:** Rate limit tracker, cooldown, chain router (non-streaming)
4. **Proxy Endpoint:** HTTP server, auth middleware, chat/completions route (non-streaming)
5. **Streaming:** SSE parser, writer, bridge, streaming support in chain router
6. **Tracking:** Usage collector, request logging, stats aggregation
7. **Admin API:** CRUD for providers/chains, stats endpoints
8. **Web UI:** Frontend dashboard consuming admin API
9. **Polish:** Docker, CLI packaging, config file format, documentation

## Key Architectural Decisions Summary

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| HTTP Framework | **Fastify** over Express | Better TypeScript support, built-in validation, better streaming performance, plugin architecture. Express is also fine but Fastify is the more modern choice. |
| Config Format | **YAML** with JSON schema validation | More human-readable than JSON for config files. Validate with Zod at load time. |
| State Management | **In-memory with periodic flush** | Rate limits change constantly. Disk I/O per request is a non-starter. Flush every 30s for crash recovery. |
| Provider Adapters | **Class-based with interface** | Clean adapter pattern. Easy to add providers. Generic OpenAI adapter covers most cases. |
| Event Bus | **Node.js EventEmitter (typed)** | Simple, zero dependencies, fast. No need for Redis pub/sub at this scale. |
| Streaming | **Native Node.js streams (pipe through)** | Do not buffer. Transform streams for interception (token counting). |
| Persistence | **JSON files for v1** | Simplest option that works. No database setup required. SQLite upgrade path exists. |
| Web UI | **Separate SPA (React or Preact)** | Clean API boundary. Could be replaced or augmented. Served as static files by the same server. |
| Validation | **Zod** | Runtime type validation, TypeScript inference, excellent DX. Used for config validation and request validation. |
| Testing | **Vitest** | Fast, TypeScript-native, good mocking support. Test each layer independently. |

## Sources

- Architecture patterns drawn from analysis of LiteLLM proxy (Python-based AI gateway with provider abstraction and fallback routing), Portkey AI Gateway (TypeScript-based gateway with similar adapter patterns), and general API gateway design patterns.
- OpenAI API specification for endpoint shapes, SSE format, and response structures.
- Rate limiting patterns from API gateway literature (circuit breaker, token bucket, sliding window).
- Node.js streaming best practices from Node.js documentation (Transform streams, backpressure handling).
- **Confidence note:** All sources are from training knowledge (cutoff May 2025). WebSearch and WebFetch were unavailable during this research session. Specific version numbers and current API details should be verified before implementation.

---
*Architecture research for: AI inference proxy/aggregator (429chain)*
*Researched: 2026-02-05*
*Tools available: Glob, Read, Write, Bash (limited). WebSearch/WebFetch unavailable.*
