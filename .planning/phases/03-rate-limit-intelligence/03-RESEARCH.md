# Phase 3: Rate Limit Intelligence - Research

**Researched:** 2026-02-05
**Domain:** Rate limit tracking, proactive quota management, provider state machines
**Confidence:** HIGH

## Summary

Phase 3 adds proactive rate limit intelligence to prevent 429 errors before they occur. The existing reactive system (Phase 1) waits for 429 responses and then applies cooldowns. This phase extends the system to parse rate limit headers from successful responses, track remaining quota in real-time, and proactively mark providers as exhausted when quota reaches zero—eliminating wasted requests.

The standard approach involves three components: (1) a header parser that normalizes provider-specific rate limit headers into a common format, (2) a state machine that tracks three states (AVAILABLE, TRACKING, EXHAUSTED) per provider+model, and (3) manual rate limit configuration as a fallback when providers don't send headers.

The project already has reactive 429 handling with CooldownTracker and composite key tracking (providerId:model). Phase 3 builds on this foundation by adding proactive header-based tracking and manual configuration support.

**Primary recommendation:** Extend the existing RateLimitTracker state machine with a TRACKING state that holds parsed header data, add quota checking logic to proactively mark providers exhausted when remainingRequests reaches 0, and add optional manual rate limit config to the provider schema for fallback limits.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 18+ | Runtime with Headers API | Native Web API support for header parsing |
| TypeScript | 5.x | Type safety for state machines | Discriminated unions for state modeling |
| Zod | 4.x | Config schema validation | Already used in project (d001) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | Latest | Testing state transitions | Already used in project |
| Pino | Latest | Structured logging | Already used in project (d003) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom state machine | XState or similar | Hand-rolled state machine is simpler for 3 states; XState adds complexity for minimal benefit |
| WeakMap for tracking | Regular Map | WeakMap provides automatic cleanup but keys must be objects; composite string keys work better here |
| Token bucket algorithm | Sliding window | Token bucket adds complexity; header-based tracking is simpler and matches provider behavior |

**Installation:**
No new dependencies required. All functionality can be built with existing stack.

## Architecture Patterns

### Recommended Project Structure
```
src/ratelimit/
├── cooldown.ts          # Existing timer management
├── tracker.ts           # Existing + extended state machine
├── types.ts             # Existing + new header/quota types
└── __tests__/
    └── tracker.test.ts  # Existing + new proactive tests
```

### Pattern 1: Rate Limit Header Normalization
**What:** Provider-specific headers normalized to common RateLimitInfo interface
**When to use:** After every successful provider response
**Example:**
```typescript
// Already implemented in project
export interface RateLimitInfo {
  limitRequests?: number;
  remainingRequests?: number;
  resetRequestsMs?: number;
  limitTokens?: number;
  remainingTokens?: number;
  resetTokensMs?: number;
}

// OpenRouter: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset (ms timestamp)
// Groq: x-ratelimit-limit-requests, x-ratelimit-remaining-requests, x-ratelimit-reset-requests (duration)
// Standards: RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset (delay-seconds per draft-ietf-httpapi-ratelimit-headers)
```

### Pattern 2: Three-State Rate Limit Machine
**What:** State transitions: AVAILABLE → TRACKING → EXHAUSTED → AVAILABLE
**When to use:** Per provider+model composite key tracking
**Example:**
```typescript
type RateLimitState = 'available' | 'tracking' | 'exhausted';

interface TrackerEntry {
  status: RateLimitState;
  cooldownUntil: number | null;
  reason: string;
  // New for Phase 3:
  quota?: {
    remainingRequests?: number;
    resetRequestsMs?: number;
    remainingTokens?: number;
    resetTokensMs?: number;
  };
}

// State transitions:
// AVAILABLE -> TRACKING: First response with rate limit headers
// TRACKING -> EXHAUSTED: remainingRequests === 0 or remainingTokens === 0
// TRACKING -> TRACKING: Update quota on each response
// EXHAUSTED -> AVAILABLE: Cooldown timer expires or manual recovery
```

### Pattern 3: Proactive Quota Checking
**What:** Check remaining quota after successful responses, mark exhausted before next request
**When to use:** In chain router after receiving ProviderResponse
**Example:**
```typescript
// From existing router.ts (lines 67-78):
const rateLimitInfo = adapter.parseRateLimitHeaders(result.headers);
if (rateLimitInfo && rateLimitInfo.remainingRequests === 0) {
  const cooldownMs = rateLimitInfo.resetRequestsMs ?? undefined;
  tracker.markExhausted(
    entry.providerId,
    entry.model,
    cooldownMs,
    'proactive: remaining requests = 0',
  );
}
```

### Pattern 4: Manual Rate Limit Configuration Fallback
**What:** User-defined rate limits when provider headers are unavailable
**When to use:** Provider doesn't send headers, or as hard limits to prevent over-quota billing
**Example:**
```typescript
// Add to ProviderSchema in config/schema.ts:
export const ProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['openrouter', 'groq', 'cerebras', 'generic-openai']),
  apiKey: z.string(),
  baseUrl: z.url().optional(),
  rateLimits: z.object({
    requestsPerMinute: z.number().int().positive().optional(),
    tokensPerMinute: z.number().int().positive().optional(),
    requestsPerDay: z.number().int().positive().optional(),
    concurrentRequests: z.number().int().positive().optional(),
  }).optional(),
});
```

### Anti-Patterns to Avoid
- **Tracking state in WeakMap:** String composite keys don't work with WeakMap (requires object keys); use regular Map with explicit cleanup
- **Global rate limit per provider:** Rate limits are per-model, not per-provider (already solved with composite key pattern in Phase 1)
- **Accumulating cooldown timers:** Replace timer on re-exhaustion, don't stack them (already solved in CooldownManager)
- **Checking remainingRequests > 1:** Edge case exists at remainingRequests === 0, not 1; mark exhausted at exactly 0

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Duration string parsing | Custom regex parser | parseDurationToMs in groq.ts | Groq's "6m23.456s" format requires hours/minutes/seconds/ms handling |
| Rate limit header standards | Custom header names | IETF draft-ietf-httpapi-ratelimit-headers | Legacy X-RateLimit-* headers have semantic ambiguity; new standard exists |
| Concurrent request tracking | Custom semaphore | Not needed for this phase | Phase 3 tracks quota, not in-flight requests; concurrent limits are RATE-05 (manual config only) |
| Token bucket algorithm | Custom implementation | Not needed for this phase | Header-based tracking is simpler; token bucket is for client-side rate limiting |
| Redis distributed tracking | External Redis dependency | In-memory Map | Single-process proxy doesn't need distributed state; Map is sufficient |

**Key insight:** The project already has 90% of the infrastructure needed. Phase 3 is about adding quota fields to existing TrackerEntry and checking them proactively, not rebuilding the state machine.

## Common Pitfalls

### Pitfall 1: Race Condition on Quota Exhaustion
**What goes wrong:** Two concurrent requests both see remainingRequests === 1, both proceed, one gets 429
**Why it happens:** Quota check and request are not atomic; providers track server-side
**How to avoid:** Accept that this race condition is unavoidable without distributed coordination; the existing 429 handler will catch it and apply reactive cooldown
**Warning signs:** Tests show occasional 429 even with proactive tracking; this is expected behavior

### Pitfall 2: Reset Timestamp Ambiguity
**What goes wrong:** X-RateLimit-Reset means different things per provider (Unix timestamp vs seconds-from-now vs duration string)
**Why it happens:** Legacy headers lack standardization; each provider invented their own format
**How to avoid:** Parse per-provider in adapter's parseRateLimitHeaders(); OpenRouter uses Unix timestamp in milliseconds (subtract Date.now()), Groq uses duration strings ("6m23s"), new standard uses delay-seconds
**Warning signs:** Cooldown expires immediately or in the year 2050; check if timestamp was treated as duration or vice versa

### Pitfall 3: Token vs Request Limits
**What goes wrong:** Tracking only remainingRequests but provider is token-limited; requests succeed but tokens exhausted
**Why it happens:** Providers enforce BOTH request and token limits; need to check both
**How to avoid:** Mark exhausted if EITHER remainingRequests === 0 OR remainingTokens === 0; use whichever cooldown is longer
**Warning signs:** Provider returns 429 even though remainingRequests > 0; check token headers

### Pitfall 4: Missing Headers on Streaming Responses
**What goes wrong:** Rate limit headers present on non-streaming responses but missing on SSE streams
**Why it happens:** Streaming responses return raw Response object before consuming body; headers may not be available until stream starts
**How to avoid:** Parse headers from executeStreamChain's Response object immediately after fetch; headers are available even though body is unconsumed
**Warning signs:** Proactive tracking works for non-streaming but not streaming; verify headers exist on Response object

### Pitfall 5: Manual Config Overriding Header Data
**What goes wrong:** User sets manual rate limit of 10 RPM, but provider headers show 100 RPM available; system uses manual limit and wastes quota
**Why it happens:** Manual config treated as authoritative instead of fallback
**How to avoid:** Manual limits are FALLBACK only; if headers exist, use headers; if no headers, enforce manual limits with client-side token bucket
**Warning signs:** Providers with generous limits are being throttled unnecessarily; check if manual config is overriding header data

### Pitfall 6: Memory Leaks from Unbounded Tracking
**What goes wrong:** Map grows indefinitely as new provider+model pairs are tracked; never cleaned up
**Why it happens:** Map holds strong references; entries added but never removed
**How to avoid:** Current design is acceptable for bounded provider+model combinations (config-defined); for dynamic scenarios, add TTL-based cleanup or LRU eviction
**Warning signs:** Memory usage grows over days/weeks; getAllStatuses() returns hundreds of entries

## Code Examples

Verified patterns from official sources:

### Proactive Exhaustion Check
```typescript
// Source: Existing router.ts lines 67-78
// Extended pattern for Phase 3:

const rateLimitInfo = adapter.parseRateLimitHeaders(result.headers);
if (rateLimitInfo) {
  // Check request limits
  if (rateLimitInfo.remainingRequests !== undefined && rateLimitInfo.remainingRequests === 0) {
    const cooldownMs = rateLimitInfo.resetRequestsMs ?? undefined;
    tracker.markExhausted(
      entry.providerId,
      entry.model,
      cooldownMs,
      'proactive: remaining requests = 0',
    );
  }

  // Check token limits
  if (rateLimitInfo.remainingTokens !== undefined && rateLimitInfo.remainingTokens === 0) {
    const cooldownMs = rateLimitInfo.resetTokensMs ?? undefined;
    tracker.markExhausted(
      entry.providerId,
      entry.model,
      cooldownMs,
      'proactive: remaining tokens = 0',
    );
  }
}
```

### Duration String Parsing (Groq Format)
```typescript
// Source: Existing groq.ts lines 24-52
// Already implemented, no changes needed:

export function parseDurationToMs(str: string): number {
  let totalMs = 0;
  const hoursMatch = str.match(/(\d+(?:\.\d+)?)h/);
  if (hoursMatch) totalMs += parseFloat(hoursMatch[1]) * 3600000;
  const minutesMatch = str.match(/(\d+(?:\.\d+)?)m(?!s)/);
  if (minutesMatch) totalMs += parseFloat(minutesMatch[1]) * 60000;
  const secondsMatch = str.match(/(\d+(?:\.\d+)?)s/);
  if (secondsMatch) totalMs += parseFloat(secondsMatch[1]) * 1000;
  const msMatch = str.match(/(\d+(?:\.\d+)?)ms/);
  if (msMatch) totalMs += parseFloat(msMatch[1]);
  return Math.round(totalMs);
}
```

### State Machine Extension
```typescript
// Source: Project requirements + standard state machine patterns
// Add to ratelimit/types.ts:

export type RateLimitState = 'available' | 'tracking' | 'exhausted';

export interface QuotaInfo {
  remainingRequests?: number;
  resetRequestsMs?: number;
  remainingTokens?: number;
  resetTokensMs?: number;
  lastUpdated: number; // Date.now() timestamp
}

export interface TrackerEntry {
  status: RateLimitState;
  cooldownUntil: number | null;
  reason: string;
  quota?: QuotaInfo; // undefined for 'available', defined for 'tracking'
}
```

### Manual Rate Limit Config Schema
```typescript
// Source: Project schema patterns + provider config research
// Add to config/schema.ts:

export const RateLimitConfigSchema = z.object({
  requestsPerMinute: z.number().int().positive().optional(),
  tokensPerMinute: z.number().int().positive().optional(),
  requestsPerDay: z.number().int().positive().optional(),
  concurrentRequests: z.number().int().positive().optional(),
}).optional();

export const ProviderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['openrouter', 'groq', 'cerebras', 'generic-openai']),
  apiKey: z.string().min(1),
  baseUrl: z.url().optional(),
  rateLimits: RateLimitConfigSchema, // New field
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| X-RateLimit-* headers | RateLimit, RateLimit-Policy headers | IETF draft 2023-2026 | New standard provides consistent semantics; legacy headers still dominant in 2026 |
| Reactive 429 handling | Proactive header tracking | Industry trend 2024-2026 | Prevents wasted requests; modern proxies track quota in real-time |
| Unix timestamp resets | Delay-seconds (relative time) | IETF draft standard | Avoids clock sync issues and thundering herd reconnects |
| Global provider limits | Per-model tracking | API providers 2023+ | Providers enforce per-model limits; global tracking misses per-model quotas |

**Deprecated/outdated:**
- **X-RateLimit-Reset as Unix timestamp:** Ambiguous (seconds vs milliseconds), subject to clock skew; new standard uses delay-seconds (relative time)
- **Single token bucket for all models:** Modern APIs have per-model limits; need composite key tracking
- **Waiting for 429 before rate limiting:** Wastes quota and increases latency; proactive tracking is standard practice in 2026

## Open Questions

Things that couldn't be fully resolved:

1. **Should manual rate limits override or supplement header data?**
   - What we know: Manual config is for fallback when headers unavailable (per requirements RATE-05)
   - What's unclear: Should manual config act as a hard cap even when headers show higher limits? (e.g., prevent surprise billing)
   - Recommendation: Implement as fallback first (Plan 03-03), document the hard-cap use case as a future enhancement

2. **Should TRACKING state auto-transition to AVAILABLE if headers stop appearing?**
   - What we know: A provider might send headers on some responses but not others
   - What's unclear: If headers present on response N but missing on response N+1, should we keep the stale quota data or discard it?
   - Recommendation: Keep stale quota data; if provider stops sending headers, stale data is still more informative than nothing; add lastUpdated timestamp to detect staleness

3. **How to handle concurrent request limits (RATE-05)?**
   - What we know: Requirements specify "concurrent request limits" as part of manual config
   - What's unclear: Concurrent limits require tracking in-flight requests (different from quota tracking); is this in scope for Phase 3?
   - Recommendation: Add concurrentRequests field to schema for Plan 03-03 but don't implement enforcement; note as "config-only, enforcement deferred" for future phase

4. **Should streaming responses parse rate limit headers proactively?**
   - What we know: executeStreamChain returns raw Response object; headers are available (lines 232-242 in router.ts)
   - What's unclear: Current code doesn't parse headers for streaming responses; should it?
   - Recommendation: Yes, add header parsing to executeStreamChain similar to executeChain; headers exist on Response object even before stream is consumed

## Sources

### Primary (HIGH confidence)
- Existing codebase analysis:
  - `src/ratelimit/tracker.ts` - Current state machine implementation
  - `src/ratelimit/cooldown.ts` - Timer management (d005: Timer.unref())
  - `src/chain/router.ts` - Proactive tracking already implemented (lines 67-78)
  - `src/providers/adapters/groq.ts` - Duration string parsing implementation
  - `src/providers/types.ts` - RateLimitInfo interface definition
  - `src/config/schema.ts` - Zod schema patterns used in project
- [IETF Draft: RateLimit Header Fields for HTTP](https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/) - Authoritative standard for rate limit headers (expires 2026-03-31)

### Secondary (MEDIUM confidence)
- [Cloudflare: Rate limiting best practices](https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/) - Industry best practices verified by major CDN provider
- [Speakeasy: Rate Limiting Best Practices in REST API Design](https://www.speakeasy.com/api-design/rate-limiting) - Standard patterns for API rate limiting
- [GitHub Rate Limits Documentation](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) - Real-world header format example
- [Microsoft Azure: Rate Limiting Pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/rate-limiting-pattern) - Architectural patterns from Microsoft
- [API Rate Limiting 2026 Guide - Levo.ai](https://www.levo.ai/resources/blogs/api-rate-limiting-guide-2026) - Current state of rate limiting in 2026
- [Gemini API Rate Limits Documentation](https://ai.google.dev/gemini-api/docs/rate-limits) - Modern API provider example (2026)
- [OpenAI API Rate Limits Guide](https://muneebdev.com/openai-api-rate-limits-guide/) - TPM/RPM tracking patterns

### Tertiary (LOW confidence)
- [Token Bucket Algorithm Tutorial](https://medium.com/@surajshende247/token-bucket-algorithm-rate-limiting-db4c69502283) - Algorithm explanation (not used in Phase 3 but relevant for future)
- [Rate Limiting Strategies: Token Bucket vs Leaky Bucket](https://www.eraser.io/decision-node/api-rate-limiting-strategies-token-bucket-vs-leaky-bucket) - Algorithm comparison
- [Concurrent Rate Limiters and Semaphores](https://blog.shalvah.me/posts/diving-into-concurrent-rate-limiters-mutexes-semaphores) - Concurrent request handling (relevant for RATE-05 future implementation)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies required; builds on existing infrastructure
- Architecture: HIGH - Patterns already partially implemented in router.ts; clear extension points identified
- Pitfalls: HIGH - Based on existing codebase analysis and official standards documentation; race conditions and header ambiguity well-documented

**Research date:** 2026-02-05
**Valid until:** 2026-03-05 (30 days - stable domain, IETF draft expires 2026-03-31 but core patterns are mature)
