---
phase: quick-005
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/config/schema.ts
  - src/providers/base-adapter.ts
  - src/providers/types.ts
  - src/providers/adapters/openrouter.ts
  - src/providers/adapters/groq.ts
  - src/providers/adapters/cerebras.ts
  - src/providers/adapters/generic-openai.ts
  - src/providers/registry.ts
  - src/chain/router.ts
  - src/api/routes/chat.ts
  - src/index.ts
  - config/config.example.yaml
  - src/chain/__tests__/router.test.ts
autonomous: true

must_haves:
  truths:
    - "Per-provider timeout in config is respected as the abort deadline for that provider's request"
    - "Global requestTimeoutMs is enforced as the default when no per-provider timeout is set"
    - "Timed-out provider waterfalls to next in chain WITHOUT applying cooldown"
    - "Client disconnect (AbortError) in streaming still does NOT waterfall (existing behavior preserved)"
    - "Existing configs without per-provider timeout continue working unchanged"
  artifacts:
    - path: "src/config/schema.ts"
      provides: "timeout field in ProviderSchema"
      contains: "timeout.*z\\.number"
    - path: "src/providers/base-adapter.ts"
      provides: "timeout property on BaseAdapter"
      contains: "public readonly timeout"
    - path: "src/chain/router.ts"
      provides: "AbortSignal.timeout per attempt, TimeoutError waterfall logic"
      contains: "AbortSignal\\.timeout"
    - path: "src/chain/__tests__/router.test.ts"
      provides: "Tests for timeout waterfall without cooldown"
      contains: "TimeoutError"
  key_links:
    - from: "src/config/schema.ts"
      to: "src/providers/registry.ts"
      via: "config.timeout passed to adapter constructor"
      pattern: "config\\.timeout"
    - from: "src/providers/base-adapter.ts"
      to: "src/chain/router.ts"
      via: "adapter.timeout read by chain executor to create AbortSignal.timeout"
      pattern: "adapter\\.timeout"
    - from: "src/chain/router.ts"
      to: "src/api/routes/chat.ts"
      via: "globalTimeoutMs parameter threaded from settings.requestTimeoutMs"
      pattern: "globalTimeoutMs"
---

<objective>
Add per-provider timeout config with waterfall on timeout (no cooldown), and enforce the existing global requestTimeoutMs that is currently never used.

Purpose: Providers like Groq sometimes hang instead of returning errors. Per-provider timeout lets fast providers fail fast (e.g., 10s) while slow providers get more time (e.g., 60s). Timeout waterfalls without cooldown because a timeout is transient, not a rate limit.

Output: Working timeout enforcement on every upstream request, configurable per-provider with global fallback, waterfall on TimeoutError without cooldown, full test coverage.
</objective>

<execution_context>
@C:\Users\danen\.claude/get-shit-done/workflows/execute-plan.md
@C:\Users\danen\.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/config/schema.ts
@src/config/types.ts
@src/providers/base-adapter.ts
@src/providers/types.ts
@src/providers/adapters/openrouter.ts
@src/providers/adapters/groq.ts
@src/providers/adapters/cerebras.ts
@src/providers/adapters/generic-openai.ts
@src/providers/registry.ts
@src/chain/router.ts
@src/chain/types.ts
@src/api/routes/chat.ts
@src/index.ts
@config/config.example.yaml
@src/chain/__tests__/router.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Config schema + adapter timeout plumbing</name>
  <files>
    src/config/schema.ts
    src/providers/base-adapter.ts
    src/providers/types.ts
    src/providers/adapters/openrouter.ts
    src/providers/adapters/groq.ts
    src/providers/adapters/cerebras.ts
    src/providers/adapters/generic-openai.ts
    src/providers/registry.ts
    config/config.example.yaml
  </files>
  <action>
    1. **src/config/schema.ts** - Add `timeout` field to `ProviderSchema`:
       ```ts
       timeout: z.number().int().min(1000).optional(),
       ```
       Place it after `rateLimits`. This is optional; existing configs without it remain valid.

    2. **src/providers/types.ts** - Add `timeout` to the `ProviderAdapter` interface:
       ```ts
       /** Per-provider request timeout in milliseconds. Undefined = use global default. */
       readonly timeout?: number;
       ```
       Add it after the `baseUrl` field in the interface.

    3. **src/providers/base-adapter.ts** - Add `timeout` as an optional constructor parameter and public readonly property:
       - Add `public readonly timeout?: number;` field declaration after `apiKey`.
       - Add `timeout?: number` as the LAST parameter of the constructor (optional param must be last).
       - Assign `this.timeout = timeout;` in constructor body.
       - Constructor signature becomes: `constructor(id, providerType, name, apiKey, baseUrl, timeout?)`

    4. **src/providers/adapters/openrouter.ts** - Update constructor to accept and pass `timeout`:
       ```ts
       constructor(id: string, name: string, apiKey: string, baseUrl?: string, timeout?: number) {
         super(id, 'openrouter', name, apiKey, baseUrl ?? DEFAULT_BASE_URL, timeout);
       }
       ```

    5. **src/providers/adapters/groq.ts** - Same pattern:
       ```ts
       constructor(id: string, name: string, apiKey: string, baseUrl?: string, timeout?: number) {
         super(id, 'groq', name, apiKey, baseUrl ?? DEFAULT_BASE_URL, timeout);
       }
       ```

    6. **src/providers/adapters/cerebras.ts** - Same pattern:
       ```ts
       constructor(id: string, name: string, apiKey: string, baseUrl?: string, timeout?: number) {
         super(id, 'cerebras', name, apiKey, baseUrl ?? DEFAULT_BASE_URL, timeout);
       }
       ```

    7. **src/providers/adapters/generic-openai.ts** - Same pattern (note: baseUrl is required here, not optional):
       ```ts
       constructor(id: string, name: string, apiKey: string, baseUrl: string, timeout?: number) {
         super(id, 'generic-openai', name, apiKey, baseUrl, timeout);
       }
       ```

    8. **src/providers/registry.ts** - Pass `config.timeout` to each adapter constructor in `createAdapter`:
       ```ts
       case 'openrouter':
         return new OpenRouterAdapter(config.id, config.name, config.apiKey, config.baseUrl, config.timeout);
       case 'groq':
         return new GroqAdapter(config.id, config.name, config.apiKey, config.baseUrl, config.timeout);
       case 'cerebras':
         return new CerebrasAdapter(config.id, config.name, config.apiKey, config.baseUrl, config.timeout);
       case 'generic-openai':
         // baseUrl is required for generic-openai (already validated above)
         return new GenericOpenAIAdapter(config.id, config.name, config.apiKey, config.baseUrl!, config.timeout);
       ```

    9. **config/config.example.yaml** - Add a `timeout` example to the groq provider (after the rateLimits block) with a comment:
       ```yaml
         - id: groq
           name: Groq
           type: groq
           apiKey: "gsk_your-key-here"
           # baseUrl defaults to https://api.groq.com/openai/v1
           timeout: 10000  # Per-provider timeout (ms). Falls back to settings.requestTimeoutMs if omitted
           # Optional: manual rate limits as fallback when provider headers unavailable
           rateLimits:
             requestsPerMinute: 30
             ...
       ```
       Place `timeout` BEFORE `rateLimits` for readability. Also add a brief comment to the global `requestTimeoutMs` clarifying it serves as the default.

    **Important:** Do NOT change any logic in router.ts or chat.ts in this task. That is Task 2.
  </action>
  <verify>
    - `npx tsc --noEmit` passes (type-check only, no runtime changes yet)
    - Existing config loader test: `npx vitest run src/config/__tests__/loader.test.ts` passes
    - Check that config types are correctly inferred: `ProviderConfig` now has `timeout?: number`
  </verify>
  <done>
    - `timeout: z.number().int().min(1000).optional()` in ProviderSchema
    - `timeout?: number` on ProviderAdapter interface and BaseAdapter class
    - All 4 adapter constructors accept and forward timeout
    - `createAdapter` in registry.ts passes config.timeout to constructors
    - config.example.yaml shows timeout usage
    - TypeScript compiles clean
  </done>
</task>

<task type="auto">
  <name>Task 2: Chain executor timeout enforcement + chat route threading + tests</name>
  <files>
    src/chain/router.ts
    src/api/routes/chat.ts
    src/index.ts
    src/chain/__tests__/router.test.ts
  </files>
  <action>
    **src/chain/router.ts changes:**

    1. Add `globalTimeoutMs` parameter to `executeChain`:
       ```ts
       export async function executeChain(
         chain: Chain,
         request: ChatCompletionRequest,
         tracker: RateLimitTracker,
         registry: ProviderRegistry,
         globalTimeoutMs: number,
       ): Promise<ChainResult> {
       ```

    2. In `executeChain`, after getting the adapter (`const adapter = registry.get(entry.providerId)`), create a timeout signal:
       ```ts
       const timeoutMs = adapter.timeout ?? globalTimeoutMs;
       const timeoutSignal = AbortSignal.timeout(timeoutMs);
       ```

    3. Pass `timeoutSignal` to `adapter.chatCompletion(entry.model, request, timeoutSignal)`.

    4. In the catch block of `executeChain`, add a NEW error branch BEFORE the generic "Unknown error" catch-all. Place it after the `ProviderError` branch:
       ```ts
       // Timeout: waterfall WITHOUT cooldown (transient, not a rate limit)
       if (error instanceof Error && error.name === 'TimeoutError') {
         const timeoutMs = adapter.timeout ?? globalTimeoutMs;
         logger.info(
           {
             provider: entry.providerId,
             model: entry.model,
             chain: chain.name,
             timeoutMs,
             latencyMs: Math.round(latencyMs),
           },
           `Provider ${entry.providerId}/${entry.model} timed out after ${timeoutMs}ms, waterfalling (no cooldown)`,
         );

         attempts.push({
           provider: entry.providerId,
           model: entry.model,
           error: `timeout_${timeoutMs}ms`,
         });
         continue;
       }
       ```
       Key: NO `tracker.markExhausted()` call -- timeout does NOT apply cooldown.

    5. Add `globalTimeoutMs` parameter to `executeStreamChain`:
       ```ts
       export async function executeStreamChain(
         chain: Chain,
         request: ChatCompletionRequest,
         tracker: RateLimitTracker,
         registry: ProviderRegistry,
         signal?: AbortSignal,
         globalTimeoutMs?: number,
       ): Promise<StreamChainResult> {
       ```
       Note: `globalTimeoutMs` is optional here to keep the existing `signal` param position stable. When not provided, no timeout is applied (backward compat for tests).

    6. In `executeStreamChain`, after getting the adapter, create a combined signal when globalTimeoutMs is available:
       ```ts
       const adapter = registry.get(entry.providerId);
       const timeoutMs = adapter.timeout ?? globalTimeoutMs;
       let effectiveSignal = signal;
       if (timeoutMs) {
         const timeoutSignal = AbortSignal.timeout(timeoutMs);
         effectiveSignal = signal
           ? AbortSignal.any([timeoutSignal, signal])
           : timeoutSignal;
       }
       ```
       Pass `effectiveSignal` to `adapter.chatCompletionStream(entry.model, request, effectiveSignal)`.

    7. In the catch block of `executeStreamChain`, add a TimeoutError branch BEFORE the AbortError check:
       ```ts
       // Timeout: waterfall WITHOUT cooldown
       if (error instanceof Error && error.name === 'TimeoutError') {
         const timeoutMs = adapter.timeout ?? globalTimeoutMs;
         logger.info(
           { provider: entry.providerId, model: entry.model, chain: chain.name, timeoutMs },
           `Provider ${entry.providerId}/${entry.model} timed out [stream], waterfalling (no cooldown)`,
         );
         attempts.push({
           provider: entry.providerId,
           model: entry.model,
           error: `timeout_${timeoutMs}ms`,
         });
         continue;
       }
       ```
       IMPORTANT: This MUST come before the `AbortError` check. `TimeoutError` is distinct from `AbortError` in Node 20+ (`AbortSignal.timeout` throws `TimeoutError`, not `AbortError`). The existing `AbortError` branch handles client disconnect -- that behavior must not change.

    **src/api/routes/chat.ts changes:**

    8. Add `globalTimeoutMs: number` parameter to `createChatRoutes`:
       ```ts
       export function createChatRoutes(
         chains: Map<string, Chain>,
         tracker: RateLimitTracker,
         registry: ProviderRegistry,
         defaultChainName: string,
         requestLogger: RequestLogger,
         globalTimeoutMs: number,
       ) {
       ```

    9. In the streaming path, pass `globalTimeoutMs` to `executeStreamChain`:
       ```ts
       streamResult = await executeStreamChain(
         chain,
         streamRequest,
         tracker,
         registry,
         abortController.signal,
         globalTimeoutMs,
       );
       ```

    10. In the non-streaming path, pass `globalTimeoutMs` to `executeChain`:
        ```ts
        const result = await executeChain(
          chain,
          cleanBody as ChatCompletionRequest,
          tracker,
          registry,
          globalTimeoutMs,
        );
        ```

    **src/index.ts changes:**

    11. Pass `config.settings.requestTimeoutMs` to `createChatRoutes`:
        ```ts
        const chatRoutes = createChatRoutes(
          chains,
          tracker,
          registry,
          config.settings.defaultChain,
          requestLogger,
          config.settings.requestTimeoutMs,
        );
        ```

    **src/chain/__tests__/router.test.ts changes:**

    12. Update ALL existing `executeChain` calls to pass a `globalTimeoutMs` argument. Use `30_000` (the default) for all existing tests so behavior doesn't change:
        ```ts
        // Before:
        await executeChain(chain, makeRequest(), tracker, registry)
        // After:
        await executeChain(chain, makeRequest(), tracker, registry, 30_000)
        ```
        Do the same systematic replacement for every `executeChain` call in the file.

    13. Add a new describe block `'Timeout waterfall'` with these tests:

        a. **"should waterfall to next provider on timeout WITHOUT applying cooldown"**
           - Create a mock adapter whose `chatCompletion` throws a `TimeoutError`:
             ```ts
             function createTimeoutAdapter(id: string): ProviderAdapter {
               return {
                 id,
                 providerType: 'test',
                 name: `Test ${id}`,
                 baseUrl: `https://${id}.example.com`,
                 chatCompletion: vi.fn(async (_model: string, _body: unknown, signal?: AbortSignal) => {
                   // Simulate a timeout error (same as AbortSignal.timeout throws)
                   const err = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
                   throw err;
                 }),
                 chatCompletionStream: vi.fn(async (_model: string, _body: unknown, signal?: AbortSignal) => {
                   const err = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
                   throw err;
                 }),
                 parseRateLimitHeaders: vi.fn(() => null),
                 getExtraHeaders: () => ({}),
               };
             }
             ```
           - Chain: timeout-adapter -> success-adapter
           - Assert: result.providerId is the success adapter
           - Assert: attempts[0].error contains 'timeout'
           - Assert: `tracker.isExhausted(timeoutAdapterId, model)` is `false` (NO cooldown)

        b. **"should waterfall on timeout in streaming path WITHOUT cooldown"**
           - Same setup but use `executeStreamChain`
           - Assert same things: waterfalls, no cooldown applied

        c. **"should use per-provider timeout over global timeout"**
           - Create adapter with `timeout: 5000` property set on the mock
           - Pass `globalTimeoutMs: 30_000` to executeChain
           - Verify the adapter's chatCompletion was called (we can't directly assert the signal timeout value, but we can verify the attempt error message contains the per-provider timeout value)
           - Use a timeout adapter that reads its own timeout to include in the error: actually simpler -- just verify the attempt record shows `timeout_5000ms` (the error string includes the timeout value from the router logic)

        d. **"should fall back to global timeout when adapter has no per-provider timeout"**
           - Create adapter WITHOUT timeout property
           - Pass `globalTimeoutMs: 15_000`
           - Use timeout adapter, verify attempt error shows `timeout_15000ms`

    14. Verify `DOMException` is available globally in Node 20+ (it is -- it's a global class). If TypeScript complains about `DOMException`, use:
        ```ts
        const err = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
        ```
        This correctly creates an error with `name === 'TimeoutError'`, matching what `AbortSignal.timeout()` throws.
  </action>
  <verify>
    - `npx tsc --noEmit` passes
    - `npx vitest run src/chain/__tests__/router.test.ts` -- all existing tests pass + new timeout tests pass
    - `npx vitest run` -- full test suite passes
  </verify>
  <done>
    - `executeChain` and `executeStreamChain` accept `globalTimeoutMs`
    - Per-attempt `AbortSignal.timeout(adapter.timeout ?? globalTimeoutMs)` created
    - Streaming combines timeout signal with client abort signal via `AbortSignal.any`
    - `TimeoutError` waterfalls without calling `tracker.markExhausted`
    - `AbortError` in streaming still throws (does not waterfall) -- existing behavior preserved
    - `chat.ts` threads `globalTimeoutMs` from settings to both chain executors
    - `index.ts` passes `config.settings.requestTimeoutMs` to `createChatRoutes`
    - Tests verify: timeout waterfalls, no cooldown on timeout, per-provider timeout takes precedence, global fallback works
    - Full test suite passes
  </done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` -- full type-check passes
2. `npx vitest run` -- all tests pass including new timeout tests
3. Manual sanity: Review that `AbortSignal.timeout` is created per-attempt in both `executeChain` and `executeStreamChain`
4. Review that TimeoutError branch comes BEFORE AbortError branch in `executeStreamChain`
5. Review that no `tracker.markExhausted` call exists in the TimeoutError handling path
6. Config backward compat: a config YAML without any `timeout` fields still loads and works (timeout defaults to global `requestTimeoutMs`)
</verification>

<success_criteria>
- The global `requestTimeoutMs` (default 30000) is now actually enforced on every upstream request
- Per-provider `timeout` in config overrides the global default for that provider
- Timed-out providers waterfall to next chain entry without cooldown
- Client disconnect (AbortError) in streaming still aborts without waterfall
- All existing tests pass without behavioral changes
- New tests cover: timeout waterfall, no-cooldown behavior, per-provider vs global timeout
</success_criteria>

<output>
After completion, create `.planning/quick/005-per-provider-timeout-waterfall/005-SUMMARY.md`
</output>
