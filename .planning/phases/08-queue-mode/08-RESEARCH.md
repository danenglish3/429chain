# Phase 8: Queue Mode - Research

**Researched:** 2026-02-27
**Domain:** In-process FIFO request queue with cooldown-triggered draining, Node.js/TypeScript
**Confidence:** HIGH

## Summary

Phase 8 adds a queue mode to 429chain so that when all providers in a chain are exhausted, requests wait in a FIFO queue rather than immediately failing with a 503. When a provider cooldown timer fires, the queue drains and re-attempts the waiting requests. This is entirely an in-process design problem — no external libraries are needed. The existing `CooldownManager` already fires callbacks on expiry; the queue hooks into those callbacks.

The core challenge is that this is a long-lived HTTP request pattern: the client's HTTP connection must stay open while the server holds the request. Hono supports this via async handlers that simply `await` a Promise — the connection stays open until the Promise resolves. The queue is therefore a collection of deferred Promises: each queued request is a `Promise` that resolves when the queue drains the request, or rejects on timeout/shutdown.

No new npm packages are required. The queue is pure in-memory state: a simple array of pending items keyed by chain name. The queue is opt-in via a config flag (`queueMode: true` or `queueMaxWaitMs`). Strict boundaries: the queue only triggers on `AllProvidersExhaustedError`, not on individual provider failures (those already waterfall).

**Primary recommendation:** Build a `RequestQueue` class that receives deferred work items, holds them by chain name, and drains on `CooldownManager` expiry callbacks. Wire it into `createChatRoutes` as an optional retry layer around the `AllProvidersExhaustedError` catch block.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js built-ins | >=20 (already required) | Promise, setTimeout, AbortSignal | Zero dependency, fits ESM codebase |
| Hono | ^4.11.7 (already installed) | HTTP handler stays open while awaiting queue | `async (c) => await queue.enqueue(...)` pattern |

### Supporting

No new packages needed. The queue uses:
- `Promise` + resolve/reject callbacks (deferred Promise pattern)
- `setTimeout` for per-request max-wait timeout (already used everywhere in this codebase)
- `AbortSignal` for client-disconnect propagation (already used in streaming)
- `EventEmitter` or direct callback on `CooldownManager` expiry (already fires `onExpire` callbacks)

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| In-process array queue | Redis queue (BullMQ, etc.) | Redis adds ops overhead, process restart drops queue — overkill for single-process proxy |
| In-process array queue | p-queue npm package | p-queue provides concurrency limiting, not cooldown-aware draining; adds dependency for no benefit |
| Deferred Promise pattern | Polling/setTimeout loop | Polling wastes CPU and adds latency vs. event-driven drain on cooldown expiry |

**Installation:** No new packages required.

## Architecture Patterns

### Recommended Project Structure

```
src/
├── queue/
│   ├── request-queue.ts     # RequestQueue class — core queue logic
│   └── types.ts             # QueueItem, QueueStats types
├── ratelimit/
│   ├── cooldown.ts          # EXISTING — add onExpire notification hook
│   └── tracker.ts           # EXISTING — add onAvailable callback support
├── config/
│   └── schema.ts            # Add queueMode, queueMaxWaitMs, queueMaxSize settings
└── api/routes/
    └── chat.ts              # Wire queue around AllProvidersExhaustedError catch
```

### Pattern 1: Deferred Promise Queue Item

**What:** Each queued request is represented as a Promise with its resolve/reject callbacks captured externally. The HTTP handler awaits the Promise; the queue resolves it when a provider becomes available.

**When to use:** Any time you need to hold an in-flight HTTP request pending an asynchronous event (like a cooldown expiring).

```typescript
// Source: standard Node.js deferred promise pattern
interface QueueItem {
  chainName: string;
  execute: () => Promise<ChainResult | StreamChainResult>;
  resolve: (result: ChainResult | StreamChainResult) => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
  timeoutHandle: NodeJS.Timeout;
}

class RequestQueue {
  private queues = new Map<string, QueueItem[]>();

  enqueue(
    chainName: string,
    execute: () => Promise<ChainResult | StreamChainResult>,
    maxWaitMs: number,
  ): Promise<ChainResult | StreamChainResult> {
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        // Remove from queue, reject with timeout error
        this.dequeue(chainName, item);
        reject(new QueueTimeoutError(chainName, maxWaitMs));
      }, maxWaitMs);

      const item: QueueItem = {
        chainName,
        execute,
        resolve,
        reject,
        enqueuedAt: Date.now(),
        timeoutHandle,
      };

      const queue = this.queues.get(chainName) ?? [];
      queue.push(item);
      this.queues.set(chainName, queue);
    });
  }
}
```

### Pattern 2: Drain on CooldownManager Expiry

**What:** When any provider in a chain comes off cooldown, try to drain the queue for that chain. Draining means: take the next item in FIFO order, call `execute()`, and resolve/reject accordingly.

**When to use:** The drain callback is wired into `CooldownManager.schedule()`'s `onExpire` callback, or into a new `onAvailable` hook on `RateLimitTracker`.

```typescript
// Source: existing CooldownManager.schedule() pattern in src/ratelimit/cooldown.ts
// The onExpire callback already fires when a cooldown ends.
// Wire the queue drain here:

// In RateLimitTracker.markAvailable():
markAvailable(providerId: string, model: string): void {
  // ... existing state update ...
  // NEW: notify queue that this chain may have a provider available
  this.onAvailableCallback?.(providerId, model);
}
```

### Pattern 3: Queue Wrapping in Chat Route

**What:** In `chat.ts`, the existing `AllProvidersExhaustedError` catch block currently returns a 503. In queue mode, instead of returning 503, enqueue the request and await the queue Promise.

**When to use:** When `queueMode` is enabled in config.

```typescript
// Source: src/api/routes/chat.ts existing pattern — extending the catch block
try {
  result = await executeChain(chain, cleanBody, tracker, registry, globalTimeoutMs);
} catch (error) {
  if (error instanceof AllProvidersExhaustedError && queue) {
    // Queue the re-attempt, await the deferred Promise
    // The HTTP connection stays open here
    result = await queue.enqueue(
      chain.name,
      () => executeChain(chain, cleanBody, tracker, registry, globalTimeoutMs),
      maxWaitMs,
    ) as ChainResult;
  } else {
    throw error;
  }
}
```

### Pattern 4: Config-Gated Queue Initialization

**What:** The queue is only created when `settings.queueMode: true`. Pass it as optional dependency to `createChatRoutes` (already uses factory pattern from d007).

```typescript
// src/index.ts — existing factory pattern extended
const queue = config.settings.queueMode
  ? new RequestQueue(config.settings.queueMaxSize)
  : undefined;

// Wire tracker.onAvailable to queue.drain (when queue exists)
if (queue) {
  tracker.setOnAvailableCallback((providerId, model) => {
    // Find chains that include this provider+model and drain those queues
    queue.drainChains(getChainNamesForProvider(chains, providerId, model));
  });
}

const chatRoutes = createChatRoutes(
  chains, tracker, registry, defaultChainName,
  requestLogger, globalTimeoutMs, normalizeResponses,
  streamIdleTimeoutMs,
  queue,              // NEW optional parameter
  config.settings.queueMaxWaitMs,
);
```

### Anti-Patterns to Avoid

- **Polling the tracker from the queue:** Don't use `setInterval` to check if providers are available. Use event-driven drain from the `onExpire` callback — zero wasted cycles and immediate response.
- **Single global queue without chain key:** Queue must be per-chain-name. Different chains have different provider sets; draining one chain's queue when a provider in a different chain becomes available wastes an attempt.
- **Draining all items at once:** On cooldown expiry, drain only one item at a time (try first, if successful remove from queue; if it fails and exhausts again, stop draining — remaining items stay queued). Otherwise you hit the recovered provider with a burst that re-triggers the 429.
- **Not clearing timeoutHandle on successful drain:** Memory leak — the per-item timeout `setTimeout` must be cleared when the item is resolved normally.
- **Holding open streaming requests in the queue:** Streaming is harder — the queue for streaming must drain before `executeStreamChain` is called (which is before `streamSSE()`). This is already possible because `executeStreamChain` is called outside `streamSSE()` (d013). The queue wraps the same way as non-streaming.
- **Not propagating client disconnect to queued items:** If the client disconnects while their request is queued, the item must be removed and its Promise rejected. Use `req.signal` (Hono context provides the raw request) to detect disconnect.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Concurrency-safe queue drain | Custom mutex/lock | Single-item drain with re-check of `isExhausted` after `execute()` | Node.js is single-threaded; the double-check of `cooldownUntil` (d006) already handles the race condition |
| Persistent queue across restarts | SQLite-backed queue | In-memory only | Queue items are HTTP requests with open connections; they cannot survive a restart. Document this as expected behavior. |
| Queue depth monitoring | External metrics | Return queue stats from existing `/v1/ratelimits` endpoint | Already has the observability route; extend it with queue depth per chain |

**Key insight:** Node.js single-threaded execution means no true race conditions within a drain cycle. The existing `isExhausted` double-check (d006) is sufficient — just call it again before executing from the queue.

## Common Pitfalls

### Pitfall 1: Draining Causes Re-exhaustion Storm

**What goes wrong:** A provider comes off cooldown. Queue drain fires. All N queued items execute nearly simultaneously. The newly-available provider gets hit N times, the first one or two succeed but the rest trigger another 429. Provider re-enters cooldown. Those N-2 items re-enter the queue. This can cascade.

**Why it happens:** Draining the entire queue at once to a single provider doesn't respect rate limits.

**How to avoid:** Drain exactly one item per cooldown expiry. After that item's `execute()` succeeds, check if the provider still has quota (via `tracker.isExhausted`) and drain one more. Repeat until exhausted or queue empty. This is conservative but correct. Alternatively: drain up to `concurrentRequests` limit from config if set.

**Warning signs:** Queue never empties; same providers repeatedly cycling through cooldown.

### Pitfall 2: Queue Timeout vs. Client Disconnect

**What goes wrong:** Two separate signals can cancel a queued request: the queue's max-wait timer fires, OR the client disconnects. If both happen near-simultaneously, the Promise may be resolved/rejected twice (double-settle).

**Why it happens:** The timeout `setTimeout` and the client disconnect handler are both racing to call `reject()`.

**How to avoid:** Use a `settled` flag on each queue item. First to call `resolve/reject` sets `settled = true`; subsequent calls are no-ops. Always `clearTimeout(item.timeoutHandle)` when settling via client disconnect, and always check `settled` in the timeout callback.

### Pitfall 3: Drain Chain Discovery

**What goes wrong:** A provider comes off cooldown, but the queue doesn't know which chains contain that provider. If the drain is not called for the correct chain names, queued items wait unnecessarily.

**Why it happens:** The `onExpire` callback in `CooldownManager` only knows the `providerId:model` key, not which chains use it.

**How to avoid:** In `index.ts` (or the queue wiring), pre-build a lookup: `Map<string, Set<string>>` — providerId:model key → chain names. This is built once at startup from the `chains` map. When a provider comes off cooldown, look up its chain names and drain those queues.

**Warning signs:** Queue items time out despite providers being available; log shows cooldown expired but queue never draining.

### Pitfall 4: Stream Queue Race with SSE Response

**What goes wrong:** For streaming requests, `executeStreamChain` is awaited before `streamSSE()` (d013). If the queued item resolves `executeStreamChain`, the response headers are already committed to the client. But if the client disconnects during the wait, there's nothing to pipe to.

**Why it happens:** The streaming path separates "find provider and open stream" from "pipe stream to client". The queue sits between these two steps.

**How to avoid:** Check client disconnect signal before calling `streamSSE()` after queue resolution. If the AbortController has been aborted (client gone), just close the stream without writing.

**Warning signs:** Zombie upstream connections to providers for disconnected clients.

### Pitfall 5: Queue Max Size Not Enforced

**What goes wrong:** Under heavy load with all providers exhausted, the queue grows unbounded. Memory usage climbs.

**Why it happens:** No `queueMaxSize` check on `enqueue()`.

**How to avoid:** Add `queueMaxSize` config setting (default ~100). When queue is full, `enqueue()` immediately returns the `AllProvidersExhaustedError` 503 (fall through to existing behavior). Log a warning.

**Warning signs:** Process memory grows steadily under load.

## Code Examples

### Deferred Promise Pattern (Core Queue Mechanism)

```typescript
// Standard Node.js deferred promise — no library needed
// Source: well-established pattern, verified in Node.js docs behavior

type Resolver<T> = {
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  promise: Promise<T>;
};

function deferred<T>(): Resolver<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { resolve, reject, promise };
}
```

### CooldownManager Expiry Hook (Existing Code to Extend)

```typescript
// Existing src/ratelimit/cooldown.ts — the onExpire callback is already there
// Just pass the drain callback as onExpire:

cooldownManager.schedule(key, cooldownMs, () => {
  this.markAvailable(providerId, model);
  // ADD: fire registered onAvailable listeners
  this.availableListeners.forEach(cb => cb(providerId, model));
});
```

### Config Schema Extension

```typescript
// Extend SettingsSchema in src/config/schema.ts
export const SettingsSchema = z.object({
  // ... existing fields ...
  queueMode: z.boolean().default(false),
  queueMaxWaitMs: z.number().int().min(1000).default(300_000), // 5 minutes default
  queueMaxSize: z.number().int().min(1).default(100),
});
```

### Single-Item Drain Loop

```typescript
// Drain one item, then check if another can go
async drainOne(chainName: string): Promise<void> {
  const queue = this.queues.get(chainName);
  if (!queue || queue.length === 0) return;

  const item = queue[0]; // peek, don't shift yet
  if (!item) return;

  try {
    const result = await item.execute();
    // Success: remove from queue, clear timeout, resolve
    queue.shift();
    clearTimeout(item.timeoutHandle);
    item.resolve(result);
    // Try next item if queue non-empty
    if (queue.length > 0) {
      // Don't recurse synchronously — schedule microtask
      queueMicrotask(() => this.drainOne(chainName));
    }
  } catch (error) {
    if (error instanceof AllProvidersExhaustedError) {
      // Still exhausted — stop draining, item stays in queue
      return;
    }
    // Other error (non-rate-limit) — fail this item, try next
    queue.shift();
    clearTimeout(item.timeoutHandle);
    item.reject(error instanceof Error ? error : new Error(String(error)));
    queueMicrotask(() => this.drainOne(chainName));
  }
}
```

### Queue Stats for Observability

```typescript
// Expose queue depth via existing /v1/ratelimits endpoint
interface QueueStats {
  chainName: string;
  depth: number;
  oldestItemAgeMs: number | null;
}

getStats(): QueueStats[] {
  return [...this.queues.entries()]
    .filter(([, q]) => q.length > 0)
    .map(([chainName, q]) => ({
      chainName,
      depth: q.length,
      oldestItemAgeMs: q[0] ? Date.now() - q[0].enqueuedAt : null,
    }));
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Immediate 503 on all-exhausted | FIFO queue with cooldown-triggered drain | Phase 8 (new) | Clients don't need retry logic for short-duration all-exhausted scenarios |
| Client handles retry | Proxy handles retry | Phase 8 (new) | Transparent to callers using OpenAI SDK |

**Deprecated/outdated:**
- Nothing deprecated — this is purely additive. The `AllProvidersExhaustedError` 503 path remains the fallback when `queueMode: false` (default) or queue is full.

## Open Questions

1. **Should queue mode be per-chain or global?**
   - What we know: The config setting can be global (`queueMode: true`) or could be per-chain entry.
   - What's unclear: Whether users want different queue behavior for different chains.
   - Recommendation: Start with global setting (simpler). Per-chain can be a follow-up. The queue is already keyed by chain name so the data structure supports it.

2. **What HTTP status does a queue-timeout return?**
   - What we know: 503 is used for immediate all-exhausted. 504 is used for gateway timeout.
   - What's unclear: Whether 503 or 504 is more appropriate for "waited but still couldn't serve."
   - Recommendation: Use 503 with a distinct error code (`queue_timeout`) to match the existing `all_providers_exhausted` code. Clients already handle 503; this avoids breaking changes.

3. **Should queued streaming requests hold the SSE connection open or wait before accepting the connection?**
   - What we know: `executeStreamChain` is called outside `streamSSE()` (d013), so the queue can wrap the stream chain execution before the SSE response begins. The client won't know it's waiting.
   - What's unclear: Some clients (especially browser `EventSource`) may time out on long-lived pre-response waits.
   - Recommendation: Apply the same `queueMaxWaitMs` limit for streaming. For very long waits (>30s), the client may have disconnected anyway; the abort propagation handles this.

4. **Queue persistence across restarts?**
   - What we know: Queue items are open HTTP connections. They cannot survive process restart.
   - What's unclear: Whether users expect a warning when the process shuts down with items in queue.
   - Recommendation: On `SIGTERM`/`SIGINT` (graceful shutdown), reject all queued items with a `QueueShutdownError` before closing the server. This returns a clean error to connected clients rather than hanging.

## Sources

### Primary (HIGH confidence)

- Direct codebase reading — `src/ratelimit/cooldown.ts`, `src/ratelimit/tracker.ts`, `src/chain/router.ts`, `src/api/routes/chat.ts`, `src/index.ts`, `src/config/schema.ts`
- Node.js built-in Promise/deferred pattern — standard language behavior, no version concern
- Existing `CooldownManager.schedule()` callback mechanism — verified in source

### Secondary (MEDIUM confidence)

- Prior decisions d004–d016, d068–d074 from phase context — architectural choices that constrain this design
- Hono async handler behavior (connection stays open while handler awaits) — standard HTTP server behavior, consistent with `@hono/node-server` being a Node.js HTTP wrapper

### Tertiary (LOW confidence)

- None — all claims in this document are derivable from the existing codebase or standard Node.js semantics.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages, only Node.js built-ins and existing dependencies
- Architecture: HIGH — deferred Promise pattern is standard, all integration points verified in source
- Pitfalls: HIGH — derived from codebase analysis and known Node.js async patterns; the drain-storm pitfall is particularly well-established

**Research date:** 2026-02-27
**Valid until:** Stable — this is pure in-process design with no external dependencies that could change
