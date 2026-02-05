# Phase 1: Core Waterfall Proxy - Research

**Researched:** 2026-02-05
**Domain:** OpenAI-compatible HTTP proxy with waterfall routing, rate limit detection, and YAML configuration
**Confidence:** HIGH

## Summary

Phase 1 builds the foundational proxy: a non-streaming OpenAI-compatible HTTP server that waterfalls requests through ordered provider chains when rate limits (429s) are hit. The scope is precisely bounded: non-streaming chat completions, reactive 429 detection with cooldown, YAML config with Zod validation, API key auth, and health/models endpoints.

The standard approach uses Hono 4.x as the HTTP framework (with its built-in proxy helper and SSE streaming support for future phases), Zod 4.x for schema validation, the `yaml` npm package for config parsing, Pino 10.x for structured logging, and native `fetch` for upstream provider calls. All three target providers (OpenRouter, Groq, Cerebras) offer OpenAI-compatible chat completion endpoints with Bearer token auth, but differ in rate limit header formats -- requiring per-provider header parsing adapters from day one.

The primary risks for Phase 1 are: (1) underestimating provider API differences behind the "OpenAI-compatible" label, (2) designing a config schema that becomes unmanageable, and (3) leaking provider API keys through logs or error responses. All are mitigable with the adapter pattern, Zod validation with clear error messages, and a header-redaction logging strategy.

**Primary recommendation:** Build the adapter pattern and Zod config schema first -- they are the foundation everything else depends on. Use Hono's proxy helper pattern for upstream calls but with custom fetch (native `fetch`) to control header forwarding and error interception.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **hono** | ^4.11 | HTTP framework | Proxy helper built-in, SSE streaming helpers for Phase 2, middleware composition, TypeScript-first, ~14KB. Active development (v4.11.4 released Feb 2026). |
| **@hono/node-server** | ^1.19 | Node.js adapter for Hono | Bridges Web Standard APIs to Node.js http server. v1.19.9 released Feb 5, 2026. |
| **zod** | ^4.3 | Schema validation | Validates config files, incoming requests, provider responses. v4 is stable (released 2026), 14.7x faster string parsing than v3, 57% smaller bundle. TypeScript-first with `z.infer<>` for type inference. |
| **yaml** | ^2.x | YAML parsing | Modern YAML parser for Node.js. Preserves comments (important for user-edited config). More actively maintained than js-yaml (which hasn't been published in ~2 years). 82M weekly downloads. |
| **pino** | ^10.3 | Structured logging | JSON structured logging, fast, low-overhead. v10.3.0 is current. Use for request lifecycle events, error tracking, debug output. |
| **nanoid** | ^5.x | ID generation | Request IDs for tracing through waterfall chain. Shorter than UUIDs, URL-safe, fast. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **ms** | ^2.x | Time string parsing | Parse cooldown durations like "60s", "5m" from config. Tiny utility. |
| **tsx** | ^4.21 | TypeScript execution | Development runner. Runs .ts files directly via esbuild. Replaces ts-node. |
| **tsdown** | latest | Build/bundle | **Replaces tsup** (which is no longer actively maintained). Powered by Rolldown, ESM-first, tsup-compatible options. Use for production builds. |
| **vitest** | ^4.0 | Testing | Vite-native test runner. Fast, TypeScript-first. v4.0.18 is current. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| **Hono** | **Fastify** | More mature plugin ecosystem, but heavier. Hono's proxy helper and streaming support are ideal for this use case. Stick with Hono. |
| **Hono** | **Express** | Do not use. Express 4 has poor TypeScript support, no native streaming helpers, broken async error handling. Express 5 still in beta. |
| **Zod 4** | **Zod 3** | Zod 3 still works but v4 is stable, much faster, and smaller. Use v4. |
| **yaml** | **js-yaml** | js-yaml has more downloads (136M vs 82M) but hasn't been published in ~2 years. `yaml` package preserves comments and is actively maintained. Use `yaml`. |
| **tsdown** | **tsup** | tsup is no longer actively maintained. tsdown is the recommended successor, built on Rolldown. Migration is straightforward -- compatible options. |
| **Pino** | **Winston** | Winston is popular but heavier and slower. Pino's JSON output is better for structured log processing. |
| **native fetch** | **axios** | Axios adds unnecessary weight and does not handle streaming ReadableStreams well. Node 20+ native fetch does everything needed. |

**Installation:**
```bash
# Core server dependencies
npm install hono @hono/node-server zod yaml pino nanoid ms

# Dev dependencies
npm install -D typescript tsx tsdown vitest @types/node
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  index.ts              # Entry point: bootstrap Hono app, start server
  config/
    schema.ts           # Zod schemas for config file (providers, chains, settings)
    loader.ts           # Load YAML, validate with Zod, return typed config
    types.ts            # TypeScript types inferred from Zod schemas
  providers/
    types.ts            # ProviderAdapter interface, ProviderResponse, ProviderError
    registry.ts         # Map of provider ID -> adapter instance
    base-adapter.ts     # Abstract base with shared logic (auth headers, error normalization)
    adapters/
      openrouter.ts     # OpenRouter-specific: base URL, extra headers, rate limit header parsing
      groq.ts           # Groq-specific: base URL, rate limit header parsing
      cerebras.ts       # Cerebras-specific: base URL, rate limit header parsing
  chain/
    types.ts            # Chain, ChainEntry types
    router.ts           # Waterfall execution: iterate entries, skip exhausted, call adapter, handle 429
  ratelimit/
    tracker.ts          # In-memory rate limit state per provider+model
    cooldown.ts         # setTimeout-based cooldown management, auto-recovery
    types.ts            # RateLimitState (AVAILABLE/EXHAUSTED), CooldownEntry
  api/
    routes/
      chat.ts           # POST /v1/chat/completions handler
      models.ts         # GET /v1/models handler
      health.ts         # GET /health handler
    middleware/
      auth.ts           # API key validation middleware
      error-handler.ts  # Global error handler returning OpenAI-shaped errors
  shared/
    errors.ts           # Custom error classes (AllProvidersExhaustedError, ConfigError, etc.)
    logger.ts           # Pino logger instance with redaction configured
    types.ts            # Shared types (OpenAI request/response shapes)
config/
  config.example.yaml   # Example config with comments
```

### Pattern 1: Provider Adapter Pattern
**What:** Each provider implements a common interface. The chain router works with the interface, never with concrete providers.
**When to use:** Always. This is the core abstraction.
**Example:**
```typescript
// Source: Verified against OpenRouter, Groq, Cerebras API docs (Feb 2026)
interface ProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;

  // Send a chat completion request (non-streaming for Phase 1)
  chatCompletion(
    model: string,
    body: ChatCompletionRequest,
    apiKey: string,
    signal?: AbortSignal
  ): Promise<ProviderResponse>;

  // Parse rate limit headers from this provider's response
  parseRateLimitHeaders(headers: Headers): RateLimitInfo | null;

  // List available models (for /v1/models endpoint)
  listModels?(apiKey: string): Promise<ModelInfo[]>;
}

interface ProviderResponse {
  status: number;
  body: ChatCompletionResponse;  // Already in OpenAI format
  headers: Headers;              // Raw response headers for rate limit parsing
  latencyMs: number;
}
```

### Pattern 2: Waterfall Chain Execution
**What:** Sequential iteration through an ordered chain of provider+model entries. Each entry is tried; on 429 or failure, move to next. On success, return immediately.
**When to use:** For every incoming chat completion request.
**Example:**
```typescript
// Source: Architecture pattern from project research
async function executeChain(
  chain: Chain,
  request: ChatCompletionRequest,
  tracker: RateLimitTracker,
  registry: ProviderRegistry
): Promise<{ response: ChatCompletionResponse; provider: string; model: string }> {
  const attempts: AttemptRecord[] = [];

  for (const entry of chain.entries) {
    // Skip exhausted providers (reactive: cooldown from previous 429)
    if (tracker.isExhausted(entry.providerId, entry.model)) {
      attempts.push({
        provider: entry.providerId,
        model: entry.model,
        error: 'on_cooldown',
        skipped: true,
      });
      continue;
    }

    const adapter = registry.get(entry.providerId);
    try {
      const result = await adapter.chatCompletion(
        entry.model,
        request,
        entry.apiKey,
      );

      // Parse rate limit headers from successful response
      const rateLimitInfo = adapter.parseRateLimitHeaders(result.headers);
      if (rateLimitInfo) {
        tracker.update(entry.providerId, entry.model, rateLimitInfo);
      }

      return { response: result.body, provider: entry.providerId, model: entry.model };
    } catch (error) {
      if (is429Error(error)) {
        tracker.markExhausted(entry.providerId, entry.model, error);
        attempts.push({
          provider: entry.providerId,
          model: entry.model,
          error: '429_rate_limited',
          retryAfter: extractRetryAfter(error),
        });
        continue;  // Waterfall to next entry
      }
      // Non-429 provider error -- also waterfall
      attempts.push({
        provider: entry.providerId,
        model: entry.model,
        error: error.message,
      });
      continue;
    }
  }

  throw new AllProvidersExhaustedError(chain.name, attempts);
}
```

### Pattern 3: Reactive Rate Limit State Machine (Phase 1 Scope)
**What:** Simple two-state machine per provider+model: AVAILABLE or EXHAUSTED. Transitions on 429 response. Auto-recovers via setTimeout.
**When to use:** Phase 1 uses reactive-only tracking. Proactive header-based tracking is Phase 3.
**Example:**
```typescript
// Source: Rate limit pattern from project architecture research
class RateLimitTracker {
  private state = new Map<string, { status: 'available' | 'exhausted'; cooldownUntil?: number }>();
  private timers = new Map<string, NodeJS.Timeout>();

  private key(providerId: string, model: string): string {
    return `${providerId}:${model}`;
  }

  isExhausted(providerId: string, model: string): boolean {
    const entry = this.state.get(this.key(providerId, model));
    if (!entry || entry.status === 'available') return false;
    // Double-check: has cooldown expired?
    if (entry.cooldownUntil && Date.now() >= entry.cooldownUntil) {
      this.markAvailable(providerId, model);
      return false;
    }
    return true;
  }

  markExhausted(providerId: string, model: string, error: ProviderError): void {
    const k = this.key(providerId, model);
    const retryAfterMs = this.extractCooldownMs(error) || 60_000; // Default 60s
    const cooldownUntil = Date.now() + retryAfterMs;

    this.state.set(k, { status: 'exhausted', cooldownUntil });

    // Clear any existing timer and set new one for auto-recovery
    const existing = this.timers.get(k);
    if (existing) clearTimeout(existing);

    this.timers.set(k, setTimeout(() => {
      this.markAvailable(providerId, model);
    }, retryAfterMs));
  }

  markAvailable(providerId: string, model: string): void {
    const k = this.key(providerId, model);
    this.state.set(k, { status: 'available' });
    const timer = this.timers.get(k);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(k);
    }
  }

  // Parse retry-after from 429 response or rate limit headers
  private extractCooldownMs(error: ProviderError): number | null {
    // Check for retry-after header (seconds)
    const retryAfter = error.headers?.get('retry-after');
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds)) return seconds * 1000;
    }
    return null;
  }
}
```

### Pattern 4: Hono Proxy Request Pattern
**What:** Use native fetch (not Hono's proxy helper) for upstream calls to maintain full control over error handling and header manipulation.
**When to use:** For all upstream provider requests.
**Example:**
```typescript
// Source: Verified against Hono docs (hono.dev) and provider API docs (Feb 2026)
async function callProvider(
  adapter: ProviderAdapter,
  model: string,
  body: ChatCompletionRequest,
  apiKey: string,
): Promise<ProviderResponse> {
  const url = `${adapter.baseUrl}/chat/completions`;
  const start = performance.now();

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      // Provider-specific headers added by adapter
      ...adapter.getExtraHeaders(),
    },
    body: JSON.stringify({
      model,
      ...body,
      stream: false,  // Phase 1: non-streaming only
    }),
  });

  const latencyMs = performance.now() - start;

  if (response.status === 429) {
    throw new ProviderRateLimitError(adapter.id, model, response.headers);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    throw new ProviderError(adapter.id, model, response.status, errorBody);
  }

  const responseBody = await response.json() as ChatCompletionResponse;
  return { status: response.status, body: responseBody, headers: response.headers, latencyMs };
}
```

### Anti-Patterns to Avoid
- **Monolithic route handler:** Do not put chain resolution, provider calls, error handling, and rate limit tracking in one function. Separate into chain router, adapter layer, and rate limit tracker.
- **Hard-coded provider logic:** Never use `if (provider === 'groq') { ... }` outside adapter files. The chain router should work through the ProviderAdapter interface only.
- **Logging full request headers:** This leaks API keys. Configure Pino with redact paths for Authorization headers from day one.
- **Synchronous config reads on every request:** Load and validate config once at startup, cache in memory. Only re-read on explicit reload signal.
- **String-building for error responses:** Use a proper error response builder that always produces valid OpenAI error schema (`{ error: { message, type, param, code } }`).

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parsing | Custom YAML tokenizer | `yaml` npm package | YAML spec is deceptively complex (anchors, aliases, multiline strings, implicit type coercion). The `yaml` package handles all edge cases. |
| Schema validation | Manual if/else checking | Zod 4 | Zod gives you runtime validation + TypeScript type inference + human-readable error messages. Manual validation always has gaps. |
| Request/response types | Hand-written TypeScript interfaces | Zod schemas with `z.infer<>` | Single source of truth. Schema validates at runtime, type checks at compile time. No drift between validation and types. |
| Structured logging | `console.log` with formatting | Pino | Pino outputs JSON by default, supports log levels, is async (non-blocking), and supports redaction patterns for secrets. Console.log blocks the event loop and has no structure. |
| Time duration parsing | Custom regex for "60s", "5m" | `ms` package | Tiny utility that handles all time string formats. No reason to parse manually. |
| ID generation | `Math.random().toString(36)` | `nanoid` | Nanoid is cryptographically strong, URL-safe, and collision-resistant. Random string hacks are not. |
| HTTP server on Node.js | Raw `http.createServer` | `@hono/node-server` | Handles Web Standard API bridging, graceful shutdown, and all the Node.js adapter concerns. |

**Key insight:** Phase 1 has zero novel algorithmic challenges. Every component has a well-tested library. The engineering value is in correct composition, not custom implementation.

## Common Pitfalls

### Pitfall 1: Provider "OpenAI-Compatible" Lies
**What goes wrong:** Providers claim OpenAI compatibility but differ in error response shapes, rate limit header names, model ID formats, and field nullability.
**Why it happens:** Each provider implements a slightly different subset of the OpenAI spec. Response fields like `choices[0].message.content` may be `null`, empty string `""`, or absent entirely depending on provider.
**How to avoid:** Build the provider adapter layer in Plan 01-02. Each adapter normalizes responses to a canonical OpenAI shape before returning to the chain router. Never pass raw provider responses to the client.
**Warning signs:** "Works with OpenRouter but not Groq" bug reports.

### Pitfall 2: Rate Limit Header Format Varies by Provider
**What goes wrong:** You write a single header parser and it only works for one provider because header names and value formats differ.
**Why it happens:** Verified differences (HIGH confidence):
- **OpenRouter:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (reset is Unix timestamp in **milliseconds**)
- **Groq:** `x-ratelimit-limit-requests`, `x-ratelimit-limit-tokens`, `x-ratelimit-remaining-requests`, `x-ratelimit-remaining-tokens`, `x-ratelimit-reset-requests`, `x-ratelimit-reset-tokens`, `retry-after` (only on 429)
- **Cerebras:** `x-ratelimit-limit-requests-day`, `x-ratelimit-limit-tokens-minute`, `x-ratelimit-remaining-requests-day`, `x-ratelimit-remaining-tokens-minute`, `x-ratelimit-reset-requests-day`, `x-ratelimit-reset-tokens-minute`
**How to avoid:** Each adapter implements `parseRateLimitHeaders()` with provider-specific logic. The rate limit tracker works with a normalized `RateLimitInfo` type, never raw headers.
**Warning signs:** Rate limit tracking works for one provider but not others.

### Pitfall 3: API Key Leakage in Logs and Errors
**What goes wrong:** Provider API keys appear in log output, error responses to clients, or stack traces.
**Why it happens:** Logging full request headers (which include `Authorization: Bearer sk-...`), returning raw provider error messages (which may include the request URL with auth details), or including config dumps in error output.
**How to avoid:** Configure Pino with `redact: ['req.headers.authorization', 'req.headers["api-key"]']` from the first log statement. Never return raw provider error bodies to the client -- build a sanitized OpenAI-format error instead. Store API keys in config but never log config objects without redaction.
**Warning signs:** `grep -ri "sk-" logs/` or `grep -ri "Bearer" logs/` finds matches.

### Pitfall 4: Config Schema Lock-in
**What goes wrong:** The initial config schema is designed for Phase 1 only, then every subsequent phase requires breaking changes that invalidate existing user configs.
**Why it happens:** Not thinking ahead about what fields will be needed for streaming (Phase 2), proactive rate limits (Phase 3), and the web UI (Phase 5).
**How to avoid:** Design the YAML config schema with room for future sections. Use a `version` field. Make all non-essential fields optional with sensible defaults. Use Zod's `.default()` and `.optional()` extensively. Include a `settings` section for proxy-level config that will grow.
**Warning signs:** Phase 2 planning requires a config migration.

### Pitfall 5: OpenAI SDK Expects /v1/models
**What goes wrong:** A developer points the OpenAI SDK at the proxy and it fails during initialization because the SDK calls `GET /v1/models` and the proxy returns 404.
**Why it happens:** The OpenAI SDK validates the API connection by listing models. If `/v1/models` is missing, initialization fails or logs warnings.
**How to avoid:** Implement `/v1/models` in Phase 1 (it's in the requirements as PRXY-04). Return the models available in configured chains. Response format: `{ object: "list", data: [{ id: "model-name", object: "model", created: timestamp, owned_by: "provider-name" }] }`.
**Warning signs:** "Connection refused" or "404" errors from OpenAI SDK clients during setup.

### Pitfall 6: Not Handling Non-429 Provider Errors in Waterfall
**What goes wrong:** A provider returns 500, 502, 503, or a timeout. The proxy treats this as a fatal error instead of waterfalling to the next provider.
**Why it happens:** The waterfall logic only checks for 429 status codes and misses other failure modes.
**How to avoid:** The waterfall should continue on ANY provider failure (429, 5xx, timeout, connection refused). The only errors that should NOT trigger waterfall are client-side errors (400 from bad request format) that would fail on every provider. Define a clear set of "waterfallable" error types.
**Warning signs:** A single provider going down takes the whole proxy down.

## Code Examples

Verified patterns from official sources:

### Hono App Setup with Node.js Adapter
```typescript
// Source: https://hono.dev/docs/getting-started/nodejs
import { Hono } from 'hono';
import { serve } from '@hono/node-server';

const app = new Hono();

// Routes mounted here
app.route('/v1', v1Routes);
app.route('/', healthRoutes);

const server = serve({
  fetch: app.fetch,
  port: config.port,
});

// Graceful shutdown
process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());
```

### Hono Auth Middleware
```typescript
// Source: https://hono.dev/docs/guides/middleware
import { createMiddleware } from 'hono/factory';

const authMiddleware = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({
      error: {
        message: 'Missing or invalid API key. Provide a valid key in the Authorization header.',
        type: 'invalid_request_error',
        param: null,
        code: 'invalid_api_key',
      }
    }, 401);
  }

  const apiKey = authHeader.slice(7); // Remove 'Bearer '
  if (!config.apiKeys.includes(apiKey)) {
    return c.json({
      error: {
        message: 'Invalid API key provided.',
        type: 'invalid_request_error',
        param: null,
        code: 'invalid_api_key',
      }
    }, 401);
  }

  await next();
});
```

### YAML Config Loading with Zod Validation
```typescript
// Source: yaml npm package (https://www.npmjs.com/package/yaml) + Zod v4 (https://zod.dev)
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const ProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['openrouter', 'groq', 'cerebras', 'generic-openai']),
  apiKey: z.string().startsWith('sk-').or(z.string().min(1)),
  baseUrl: z.string().url().optional(),
});

const ChainEntrySchema = z.object({
  provider: z.string(),  // references provider.id
  model: z.string(),
});

const ChainSchema = z.object({
  name: z.string(),
  entries: z.array(ChainEntrySchema).min(1),
});

const ConfigSchema = z.object({
  version: z.literal(1),
  settings: z.object({
    port: z.number().int().min(1).max(65535).default(3429),
    apiKeys: z.array(z.string().min(1)).min(1),
    defaultChain: z.string(),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    cooldownDefaultMs: z.number().int().min(1000).default(60000),
  }),
  providers: z.array(ProviderSchema).min(1),
  chains: z.array(ChainSchema).min(1),
});

type Config = z.infer<typeof ConfigSchema>;

function loadConfig(path: string): Config {
  const raw = readFileSync(path, 'utf-8');
  const parsed = parseYaml(raw);
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    // Zod v4: use z.prettifyError() for human-readable output
    console.error('Config validation failed:');
    console.error(z.prettifyError(result.error));
    process.exit(1);
  }
  return result.data;
}
```

### OpenAI-Compatible Non-Streaming Response Shape
```typescript
// Source: https://platform.openai.com/docs/api-reference/chat (verified Feb 2026)
interface ChatCompletionResponse {
  id: string;                    // e.g., "chatcmpl-abc123"
  object: 'chat.completion';     // always this literal
  created: number;               // Unix timestamp (seconds)
  model: string;                 // e.g., "llama-3.1-8b-instant"
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  system_fingerprint?: string;
}
```

### OpenAI-Compatible Error Response Shape
```typescript
// Source: OpenAI API docs + SDK error handling
interface OpenAIErrorResponse {
  error: {
    message: string;     // Human-readable description
    type: string;        // e.g., "invalid_request_error", "server_error"
    param: string | null;// Parameter that caused error, or null
    code: string | null; // Specific error code, or null
  };
}

// Example for all-providers-exhausted:
// {
//   error: {
//     message: "All providers exhausted. Tried: openrouter/llama-3.1-8b (429 rate limited), groq/llama-3.1-8b-instant (429 rate limited), cerebras/llama-3.1-8b (connection timeout)",
//     type: "server_error",
//     param: null,
//     code: "all_providers_exhausted"
//   }
// }
```

### OpenAI-Compatible /v1/models Response Shape
```typescript
// Source: https://platform.openai.com/docs/api-reference/models/list
interface ModelsResponse {
  object: 'list';
  data: Array<{
    id: string;         // e.g., "llama-3.1-8b-instant"
    object: 'model';    // always "model"
    created: number;    // Unix timestamp
    owned_by: string;   // e.g., "groq", "openrouter"
  }>;
}
```

### Provider Rate Limit Header Reference
```typescript
// Source: Verified against official docs (Feb 2026)

// OpenRouter: https://openrouter.ai/docs/api/reference/limits
interface OpenRouterRateLimitHeaders {
  'X-RateLimit-Limit': string;       // Max requests in window
  'X-RateLimit-Remaining': string;   // Requests remaining
  'X-RateLimit-Reset': string;       // Unix timestamp in MILLISECONDS
}

// Groq: https://console.groq.com/docs/rate-limits
interface GroqRateLimitHeaders {
  'retry-after': string;                     // Seconds (only on 429)
  'x-ratelimit-limit-requests': string;      // Daily request quota (RPD)
  'x-ratelimit-limit-tokens': string;        // Per-minute token quota (TPM)
  'x-ratelimit-remaining-requests': string;  // Remaining daily requests
  'x-ratelimit-remaining-tokens': string;    // Remaining tokens this minute
  'x-ratelimit-reset-requests': string;      // Time until daily limit resets
  'x-ratelimit-reset-tokens': string;        // Time until TPM limit resets
}

// Cerebras: https://inference-docs.cerebras.ai/support/rate-limits
interface CerebrasRateLimitHeaders {
  'x-ratelimit-limit-requests-day': string;       // Daily request max
  'x-ratelimit-limit-tokens-minute': string;       // Per-minute token max
  'x-ratelimit-remaining-requests-day': string;    // Available daily requests
  'x-ratelimit-remaining-tokens-minute': string;   // Available per-minute tokens
  'x-ratelimit-reset-requests-day': string;        // Seconds until daily reset
  'x-ratelimit-reset-tokens-minute': string;       // Seconds until per-minute reset
}
```

### Provider API Endpoints Reference
```typescript
// Source: Verified against official docs (Feb 2026)
const PROVIDER_ENDPOINTS = {
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    chatCompletions: '/chat/completions',
    models: '/models',
    auth: 'Bearer',  // Authorization: Bearer <key>
    extraHeaders: {
      'HTTP-Referer': 'optional-app-url',  // Identifies your app
      'X-Title': 'optional-app-name',       // Your app's title
    },
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    chatCompletions: '/chat/completions',
    models: '/models',
    auth: 'Bearer',
    extraHeaders: {},
  },
  cerebras: {
    baseUrl: 'https://api.cerebras.ai/v1',
    chatCompletions: '/chat/completions',
    models: '/models',
    auth: 'Bearer',
    extraHeaders: {},
    // NOTE: Does not support `presence_penalty` parameter
    // NOTE: Free tier limited to 8,192 token context length
  },
} as const;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Zod v3 (`z.string().email()`) | Zod v4 (`z.email()`) with unified `error` param | 2026 | Use v4 API. String formats promoted to top-level functions. `message`/`invalid_type_error`/`required_error` replaced by single `error` param. |
| tsup for bundling | tsdown (Rolldown-based) | 2025-2026 | tsup no longer actively maintained. tsdown is the recommended successor with compatible options. |
| Express for HTTP | Hono (Web Standards) | 2024-2025 | Hono is the standard for new TypeScript proxy/API projects. Express is legacy. |
| node-fetch / axios | Native `fetch` (Node 20+) | 2023 | Node 20+ includes native fetch. No external HTTP client needed. |
| js-yaml for YAML | `yaml` npm package | 2024-2025 | `yaml` package is actively maintained, preserves comments, modern API. js-yaml hasn't published in ~2 years. |
| Zod v3 `safeParse` errors | Zod v4 `z.prettifyError()` | 2026 | Built-in pretty-printing for validation errors. Excellent for config file validation UX. |

**Deprecated/outdated:**
- **tsup:** No longer actively maintained. Use tsdown.
- **Zod v3 error customization API:** `message`, `invalid_type_error`, `required_error` params replaced by unified `error` param in v4.
- **node-fetch:** Unnecessary on Node 20+. Use native fetch.
- **Express:** Poor TypeScript support, no streaming helpers. Use Hono.

## Open Questions

Things that couldn't be fully resolved:

1. **OpenRouter rate limit header specifics on free models**
   - What we know: OpenRouter returns `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers. Free tier is 50 RPD without credits, 1000 RPD with 10+ credits purchased. 20 RPM for free users.
   - What's unclear: Whether free model (:free suffix) rate limit headers are per-model or account-wide. Whether the reset timestamp is consistently in milliseconds.
   - Recommendation: Implement header parsing based on documented format. Validate during first integration test with real API calls. Be prepared to adjust parser.

2. **Cerebras unsupported parameters**
   - What we know: Cerebras doesn't support `presence_penalty` and has limited context length (8,192 tokens on free tier).
   - What's unclear: The full list of unsupported OpenAI parameters. Whether sending unsupported params causes 400 errors or silent ignoring.
   - Recommendation: Start with the Cerebras adapter stripping known unsupported params. Log warnings when stripping. Expand the strip-list as integration tests reveal more.

3. **Zod v4 migration specifics for error customization**
   - What we know: Zod v4 is stable, 14.7x faster. Breaking changes exist in error customization API.
   - What's unclear: Whether any third-party libraries we might add are Zod v4 compatible.
   - Recommendation: Use Zod v4 from the start. Phase 1 has no third-party Zod dependencies, so no compatibility risk.

4. **tsdown maturity for production builds**
   - What we know: tsdown is recommended as tsup replacement, built on Rolldown, compatible options.
   - What's unclear: How stable tsdown is for production builds (it is relatively new).
   - Recommendation: Use tsdown. If issues arise, tsup 8.5.1 still works and the migration path between them is trivial (compatible config).

## Sources

### Primary (HIGH confidence)
- [Hono official docs](https://hono.dev/docs/) - Framework setup, proxy helper, streaming, middleware, Node.js adapter
- [Hono proxy helper](https://hono.dev/docs/helpers/proxy) - Proxy function API, ProxyRequestInit interface, security considerations
- [Hono streaming helper](https://hono.dev/docs/helpers/streaming) - stream(), streamSSE(), streamText() APIs
- [Groq rate limit docs](https://console.groq.com/docs/rate-limits) - Header names, tier limits, RPM/RPD/TPM/TPD metrics
- [Cerebras rate limit docs](https://inference-docs.cerebras.ai/support/rate-limits) - Header names, free tier limits, token bucketing
- [OpenRouter rate limit docs](https://openrouter.ai/docs/api/reference/limits) - Credit-based tiers, free model limits
- [OpenRouter API reference](https://openrouter.ai/docs/api/reference/overview) - Endpoint structure, auth, OpenAI compatibility
- [Zod v4 release notes](https://zod.dev/v4) - Breaking changes, new features, performance improvements

### Secondary (MEDIUM confidence)
- [npm package versions](https://www.npmjs.com/) - hono 4.11.4, @hono/node-server 1.19.9, zod ~4.3, pino 10.3.0, tsx 4.21.0, vitest 4.0.18
- [tsdown docs](https://tsdown.dev/guide/) - Migration from tsup, Rolldown-based bundling
- [yaml npm package](https://www.npmjs.com/package/yaml) vs [js-yaml](https://www.npmjs.com/package/js-yaml) - Comparison, maintenance status
- [OpenAI API reference](https://platform.openai.com/docs/api-reference/chat) - Chat completion response schema, models endpoint, error format (verified structure but could not fetch full page due to 403)
- [Cerebras OpenAI compatibility](https://inference-docs.cerebras.ai/resources/openai) - Supported/unsupported features
- [LiteLLM issue #9035](https://github.com/BerriAI/litellm/issues/9035) - OpenRouter free model 429 handling

### Tertiary (LOW confidence)
- Training knowledge: Exact Zod v4 error customization migration details (breaking change specifics). Should be validated against migration guide before implementation.
- Training knowledge: Full list of Cerebras unsupported parameters. Validate during integration testing.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All versions verified via web search, official docs fetched for core frameworks
- Architecture: HIGH - Patterns verified against Hono docs, provider APIs, and prior project research
- Pitfalls: HIGH - Provider header differences verified against three separate official documentation pages
- Code examples: HIGH - Based on verified Hono APIs and provider documentation

**Research date:** 2026-02-05
**Valid until:** 2026-03-05 (30 days - stable domain, libraries well-established)
