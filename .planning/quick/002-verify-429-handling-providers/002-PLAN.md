---
phase: quick
plan: 002
type: execute
wave: 1
depends_on: []
files_modified:
  - src/chain/router.ts
  - src/chain/__tests__/router.test.ts
autonomous: true

must_haves:
  truths:
    - "Float retry-after values (e.g. Groq's 8.12s) are parsed without truncation"
    - "OpenRouter 402 (credit exhaustion) triggers cooldown so the provider is skipped on subsequent requests"
    - "Existing 429 and ProviderError waterfall behavior is unchanged"
  artifacts:
    - path: "src/chain/router.ts"
      provides: "parseFloat for retry-after, 402 cooldown in ProviderError catch"
    - path: "src/chain/__tests__/router.test.ts"
      provides: "Tests for float retry-after and 402 cooldown"
  key_links:
    - from: "src/chain/router.ts"
      to: "RateLimitTracker.markExhausted"
      via: "402 ProviderError catch block"
      pattern: "error\\.statusCode === 402"
---

<objective>
Fix two 429/rate-limit handling gaps in the chain executor:
1. Parse retry-after header with parseFloat instead of parseInt (Groq sends floats like "8.12")
2. Apply cooldown to OpenRouter 402 (Payment Required / credits exhausted) so the provider is skipped

Purpose: Providers returning 402 currently waterfall but get no cooldown, so they are retried immediately on the next request. Float retry-after values lose sub-second precision.
Output: Patched router.ts with tests proving both fixes.
</objective>

<execution_context>
@C:\Users\danen\.claude/get-shit-done/workflows/execute-plan.md
@C:\Users\danen\.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/chain/router.ts
@src/chain/__tests__/router.test.ts
@src/shared/errors.ts
@src/providers/base-adapter.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix retry-after parsing and add 402 cooldown in router.ts</name>
  <files>src/chain/router.ts</files>
  <action>
Two changes in src/chain/router.ts:

**Fix 1 — parseFloat for retry-after (lines 102 and 259):**
In both `executeChain` and `executeStreamChain`, inside the `ProviderRateLimitError` catch block, change:
```ts
const seconds = parseInt(retryAfterHeader, 10);
```
to:
```ts
const seconds = parseFloat(retryAfterHeader);
```
This appears in two places — the non-streaming catch (line 102) and the streaming catch (line 259). Change both.

**Fix 2 — 402 cooldown in ProviderError catch block:**
In both `executeChain` and `executeStreamChain`, inside the `ProviderError` catch block (the `if (error instanceof ProviderError)` section), add a check for statusCode 402 BEFORE the existing log+continue. When 402 is detected, call `tracker.markExhausted()` with a longer cooldown (5 minutes = 300_000ms) and reason `'402 payment required (credits exhausted)'`.

In `executeChain` (around line 135), the ProviderError block should become:
```ts
if (error instanceof ProviderError) {
  // 402 Payment Required: credit exhaustion — apply long cooldown
  if (error.statusCode === 402) {
    tracker.markExhausted(
      entry.providerId,
      entry.model,
      300_000, // 5 minutes — credits won't recover quickly
      '402 payment required (credits exhausted)',
    );
  }

  // Non-429 provider error (5xx, 402, etc.): waterfall to next
  logger.info(
    {
      provider: entry.providerId,
      model: entry.model,
      chain: chain.name,
      statusCode: error.statusCode,
      latencyMs: Math.round(latencyMs),
    },
    `Provider ${entry.providerId}/${entry.model} returned ${error.statusCode}, waterfalling`,
  );

  attempts.push({
    provider: entry.providerId,
    model: entry.model,
    error: `${error.statusCode}: ${error.message}`,
  });
  continue;
}
```

Apply the same 402 pattern in `executeStreamChain` (around line 286), mirroring the structure (no `latencyMs` in the log there, matching existing style).

Do NOT modify base-adapter.ts or openrouter.ts — handling 402 in the router is cleaner because it applies to any provider that might return 402.
  </action>
  <verify>Run `npx vitest run src/chain/__tests__/router.test.ts` — all existing tests pass (no regressions).</verify>
  <done>parseFloat used in both retry-after parsing locations. 402 triggers markExhausted with 5min cooldown in both executeChain and executeStreamChain.</done>
</task>

<task type="auto">
  <name>Task 2: Add tests for float retry-after and 402 cooldown</name>
  <files>src/chain/__tests__/router.test.ts</files>
  <action>
Add the following tests to src/chain/__tests__/router.test.ts:

**Test 1 — Float retry-after parsing (add to the existing `executeChain` describe block):**
```ts
it('should parse float retry-after values without truncation', async () => {
  // Groq sends retry-after: 8.12
  const adapter1 = createRateLimitAdapter('provider-a', 8.12);
  const adapter2 = createSuccessAdapter('provider-b');
  const registry = createRegistry([adapter1, adapter2]);

  const chain: Chain = {
    name: 'test-chain',
    entries: [
      { providerId: 'provider-a', model: 'model-1' },
      { providerId: 'provider-b', model: 'model-2' },
    ],
  };

  const result = await executeChain(chain, makeRequest(), tracker, registry);

  expect(result.providerId).toBe('provider-b');
  // 8.12 seconds = 8120ms, not 8000ms (which parseInt would give)
  expect(result.attempts[0]!.retryAfter).toBe(8120);
});
```

Note: The existing `createRateLimitAdapter` helper already uses `String(retryAfterSeconds)` to set the header, so passing `8.12` will produce the header value `"8.12"`. This is correct.

**Test 2 — 402 cooldown (add a new describe block):**
```ts
describe('402 Payment Required handling', () => {
  let tracker: RateLimitTracker;

  beforeEach(() => {
    tracker = new RateLimitTracker(60_000);
  });

  afterEach(() => {
    tracker.shutdown();
  });

  it('should apply cooldown on 402 and waterfall to next provider', async () => {
    // Create adapter that returns 402 (credit exhaustion)
    const adapter402: ProviderAdapter = {
      id: 'openrouter',
      providerType: 'test',
      name: 'Test openrouter',
      baseUrl: 'https://openrouter.example.com',
      chatCompletion: vi.fn(async () => {
        throw new ProviderError('openrouter', 'test-model', 402, 'Payment Required: credits exhausted');
      }),
      chatCompletionStream: vi.fn(async () => {
        throw new ProviderError('openrouter', 'test-model', 402, 'Payment Required: credits exhausted');
      }),
      parseRateLimitHeaders: vi.fn(() => null),
      getExtraHeaders: () => ({}),
    };
    const adapter2 = createSuccessAdapter('provider-b');
    const registry = createRegistry([adapter402, adapter2]);

    const chain: Chain = {
      name: 'test-chain',
      entries: [
        { providerId: 'openrouter', model: 'test-model' },
        { providerId: 'provider-b', model: 'model-2' },
      ],
    };

    const result = await executeChain(chain, makeRequest(), tracker, registry);

    // Should waterfall to provider-b
    expect(result.providerId).toBe('provider-b');
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]!.error).toContain('402');

    // openrouter should now be on cooldown
    expect(tracker.isExhausted('openrouter', 'test-model')).toBe(true);
    const status = tracker.getStatus('openrouter', 'test-model');
    expect(status.reason).toBe('402 payment required (credits exhausted)');
  });

  it('should apply cooldown on 402 in streaming path', async () => {
    const adapter402: ProviderAdapter = {
      id: 'openrouter',
      providerType: 'test',
      name: 'Test openrouter',
      baseUrl: 'https://openrouter.example.com',
      chatCompletion: vi.fn(),
      chatCompletionStream: vi.fn(async () => {
        throw new ProviderError('openrouter', 'test-model', 402, 'Payment Required: credits exhausted');
      }),
      parseRateLimitHeaders: vi.fn(() => null),
      getExtraHeaders: () => ({}),
    };
    const adapter2 = createSuccessAdapter('provider-b');
    const registry = createRegistry([adapter402, adapter2]);

    const chain: Chain = {
      name: 'test-chain',
      entries: [
        { providerId: 'openrouter', model: 'test-model' },
        { providerId: 'provider-b', model: 'model-2' },
      ],
    };

    const result = await executeStreamChain(chain, makeRequest(), tracker, registry);

    expect(result.providerId).toBe('provider-b');
    expect(tracker.isExhausted('openrouter', 'test-model')).toBe(true);
    const status = tracker.getStatus('openrouter', 'test-model');
    expect(status.reason).toBe('402 payment required (credits exhausted)');
  });

  it('should skip 402-cooled provider on subsequent requests', async () => {
    const adapter402: ProviderAdapter = {
      id: 'openrouter',
      providerType: 'test',
      name: 'Test openrouter',
      baseUrl: 'https://openrouter.example.com',
      chatCompletion: vi.fn(async () => {
        throw new ProviderError('openrouter', 'test-model', 402, 'Payment Required');
      }),
      chatCompletionStream: vi.fn(),
      parseRateLimitHeaders: vi.fn(() => null),
      getExtraHeaders: () => ({}),
    };
    const adapter2 = createSuccessAdapter('provider-b');
    const registry = createRegistry([adapter402, adapter2]);

    const chain: Chain = {
      name: 'test-chain',
      entries: [
        { providerId: 'openrouter', model: 'test-model' },
        { providerId: 'provider-b', model: 'model-2' },
      ],
    };

    // First request: 402 triggers cooldown, waterfalls to provider-b
    await executeChain(chain, makeRequest(), tracker, registry);

    // Second request: openrouter should be skipped entirely (on cooldown)
    const result2 = await executeChain(chain, makeRequest(), tracker, registry);

    expect(result2.providerId).toBe('provider-b');
    expect(result2.attempts).toHaveLength(1);
    expect(result2.attempts[0]!.skipped).toBe(true);
    expect(result2.attempts[0]!.error).toBe('on_cooldown');

    // chatCompletion should only have been called once (first request)
    expect(adapter402.chatCompletion).toHaveBeenCalledTimes(1);
  });
});
```
  </action>
  <verify>Run `npx vitest run src/chain/__tests__/router.test.ts` — all tests pass including the 4 new ones (1 float parsing + 3 for 402 cooldown).</verify>
  <done>Tests confirm: (1) float retry-after 8.12 produces 8120ms not 8000ms, (2) 402 triggers cooldown in non-streaming, (3) 402 triggers cooldown in streaming, (4) 402-cooled provider is skipped on next request.</done>
</task>

</tasks>

<verification>
1. `npx vitest run src/chain/__tests__/router.test.ts` — all tests pass (existing + new)
2. `npx tsc --noEmit` — no type errors
3. Grep for `parseInt` in router.ts — should return zero matches (both replaced with parseFloat)
4. Grep for `statusCode === 402` in router.ts — should appear twice (executeChain + executeStreamChain)
</verification>

<success_criteria>
- Zero `parseInt` calls remain in retry-after parsing in router.ts
- 402 responses trigger `tracker.markExhausted()` with 5-minute cooldown in both streaming and non-streaming paths
- All existing tests continue to pass (no regressions)
- Four new tests pass covering float parsing and 402 cooldown behavior
</success_criteria>

<output>
After completion, create `.planning/quick/002-verify-429-handling-providers/002-SUMMARY.md`
</output>
