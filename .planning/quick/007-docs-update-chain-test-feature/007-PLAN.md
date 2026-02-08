---
phase: quick-007
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - docs/USAGE.md
  - src/api/routes/test.ts
  - src/index.ts
  - ui/src/lib/api.ts
  - ui/src/lib/queryKeys.ts
  - ui/src/pages/Test.tsx
  - ui/src/pages/Test.module.css
autonomous: true

must_haves:
  truths:
    - "docs/USAGE.md documents per-provider timeout, openai type, generic-openai baseUrl (Moonshot), 402 cooldown, and float retry-after"
    - "POST /v1/test/chain/:name tests each chain entry individually and returns per-entry results"
    - "UI Test page has a Test Chain button that shows per-entry results with color-coded status"
  artifacts:
    - path: "docs/USAGE.md"
      provides: "Updated documentation for all 5 new features"
      contains: "timeout"
    - path: "src/api/routes/test.ts"
      provides: "Chain walk test endpoint"
      exports: ["createTestRoutes"]
    - path: "ui/src/pages/Test.tsx"
      provides: "Chain test UI with results table"
      contains: "chainTestMutation"
  key_links:
    - from: "src/api/routes/test.ts"
      to: "ProviderAdapter.chatCompletion"
      via: "registry.get(entry.providerId).chatCompletion()"
      pattern: "registry\\.get.*chatCompletion"
    - from: "src/index.ts"
      to: "src/api/routes/test.ts"
      via: "import createTestRoutes, mount on v1"
      pattern: "createTestRoutes"
    - from: "ui/src/pages/Test.tsx"
      to: "/v1/test/chain/:name"
      via: "api.testChain fetch call"
      pattern: "test/chain"
---

<objective>
Update docs/USAGE.md with 5 new features added today, then build a chain walk test API endpoint (POST /v1/test/chain/:name) with UI integration.

Purpose: Keep documentation current and provide a diagnostic tool to test each provider+model in a chain individually (not waterfall), showing which entries are healthy and which fail.
Output: Updated USAGE.md, new test route, updated Test.tsx with chain test button and results display.
</objective>

<execution_context>
@C:\Users\danen\.claude/get-shit-done/workflows/execute-plan.md
@C:\Users\danen\.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@docs/USAGE.md
@src/index.ts
@src/api/routes/models.ts (factory pattern reference)
@src/api/routes/chat.ts (factory pattern with timeout reference)
@src/chain/types.ts (Chain, ChainEntry types)
@src/providers/types.ts (ProviderAdapter, ProviderRegistry, ProviderResponse)
@src/shared/types.ts (ChatCompletionRequest, ChatCompletionResponse, Usage)
@ui/src/pages/Test.tsx
@ui/src/pages/Test.module.css
@ui/src/lib/api.ts
@ui/src/lib/queryKeys.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Update docs/USAGE.md with new features</name>
  <files>docs/USAGE.md</files>
  <action>
Update docs/USAGE.md in the following sections. Make targeted edits, do NOT rewrite the entire file.

**Section 3.2 Providers table (line ~156):**
Add `timeout` field row to the provider fields table:
```
| `timeout` | number | No | Per-provider request timeout in milliseconds. Overrides global `requestTimeoutMs`. |
```

The `type` enum in the table already lists `openai` and `generic-openai` — verify this is accurate (it should be from quick task 006). If `openai` is not in the type enum description, add it.

**Section 3.2 Provider Types list (line ~165):**
Verify `openai` type is listed. It should already be there. If not, add:
```
- `openai` - OpenAI API (default baseUrl: https://api.openai.com/v1)
```

**Section 3.2 Provider example (around line ~188):**
Add timeout example to one of the existing providers in the example block. Add after the groq provider entry:
```yaml
  - id: groq
    name: Groq
    type: groq
    apiKey: "gsk_your-key-here"
    timeout: 10000  # 10 second timeout (overrides global requestTimeoutMs)
    rateLimits:
      requestsPerMinute: 30
      tokensPerMinute: 15000
```

**Section 3.4 Full Example Configuration (around line ~280):**
Ensure the full example includes:
- The `openai` provider entry (should already be there from quick 006)
- The `moonshot` generic-openai provider entry (should already be there from quick 006)
- Add `timeout: 10000` to the groq provider in the full example too

**NEW Section 4.6 — Chain Walk Test (insert BEFORE section 5 "Authentication", around line ~1117):**
Add a new subsection documenting the test endpoint:

```markdown
### 4.6 Chain Walk Test

Test each entry in a chain individually without waterfall behavior. Useful for diagnosing which providers are healthy.

#### POST /v1/test/chain/:name

Walk through each entry in the named chain, sending a test request to each provider+model individually.

**Auth:** Required (Bearer token)

**Parameters:**

- `name` (path): Chain name (e.g., "default", "fast")

**Request Body (optional):**

```json
{
  "prompt": "Say hello in one word."
}
```

If omitted, defaults to "Say hello in one word."

**Response:**

```json
{
  "chain": "default",
  "results": [
    {
      "provider": "openrouter",
      "model": "meta-llama/llama-3.1-8b-instruct:free",
      "status": "ok",
      "latencyMs": 1234,
      "response": "Hello!",
      "tokens": { "prompt": 12, "completion": 3, "total": 15 }
    },
    {
      "provider": "groq",
      "model": "llama-3.1-8b-instant",
      "status": "error",
      "latencyMs": 5023,
      "error": "429: rate limited"
    }
  ],
  "summary": {
    "total": 3,
    "ok": 2,
    "failed": 1
  }
}
```

**Result Entry Fields:**

| Field | Type | Present | Description |
|-------|------|---------|-------------|
| `provider` | string | Always | Provider ID |
| `model` | string | Always | Model ID |
| `status` | string | Always | `"ok"` or `"error"` |
| `latencyMs` | number | Always | Request latency in ms |
| `response` | string | On success | First choice content (truncated to 200 chars) |
| `tokens` | object | On success | Token usage `{ prompt, completion, total }` |
| `error` | string | On error | Error description |

**Example:**

```bash
# Test all entries in the default chain
curl -X POST http://localhost:3429/v1/test/chain/default \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Say hi"}'
```
```

**Section 7 "Error Handling" — Common Error Codes table (line ~1302):**
Add a row for 402:
```
| 402 | `payment_required` | `billing_error` | Provider requires payment (5-minute cooldown applied) |
```

**Section 8 "How Waterfall Works" — Cooldown Behavior (around line ~1398):**
Add a note about 402 and timeout behavior after the existing cooldown description:

```markdown
**402 Payment Required:** OpenRouter may return 402 when a model requires credits. The proxy treats this like a rate limit, applying a 5-minute cooldown to that provider+model pair and continuing to the next chain entry.

**Timeout Waterfall:** When a per-provider or global timeout fires, the request is aborted and the proxy moves to the next chain entry. Unlike 429 responses, timeouts do NOT apply a cooldown — the provider remains available for subsequent requests.

**Float Retry-After:** The proxy parses `retry-after` headers as floating-point values, supporting sub-second precision (e.g., `retry-after: 0.5` means 500ms).
```
  </action>
  <verify>
Read the updated docs/USAGE.md and confirm:
1. Provider table has `timeout` row
2. Section 4.6 exists with chain walk test docs
3. Error codes table has 402 row
4. Cooldown section mentions 402, timeout waterfall, and float retry-after
  </verify>
  <done>
docs/USAGE.md documents all 5 new features: per-provider timeout, openai type, Moonshot via generic-openai, 402 cooldown, float retry-after parsing, plus the new test endpoint.
  </done>
</task>

<task type="auto">
  <name>Task 2: Create chain walk test API endpoint</name>
  <files>src/api/routes/test.ts, src/index.ts</files>
  <action>
**Create `src/api/routes/test.ts`:**

Follow the factory pattern from models.ts and chat.ts. Create `createTestRoutes` that accepts `chains`, `registry`, and `globalTimeoutMs`.

```typescript
/**
 * POST /v1/test/chain/:name handler.
 * Tests each entry in a chain individually (not waterfall).
 */

import { Hono } from 'hono';
import { logger } from '../../shared/logger.js';
import type { Chain } from '../../chain/types.js';
import type { ProviderRegistry } from '../../providers/types.js';
import type { ChatCompletionRequest } from '../../shared/types.js';

interface TestEntryResult {
  provider: string;
  model: string;
  status: 'ok' | 'error';
  latencyMs: number;
  response?: string;
  tokens?: { prompt: number; completion: number; total: number };
  error?: string;
}

export function createTestRoutes(
  chains: Map<string, Chain>,
  registry: ProviderRegistry,
  globalTimeoutMs: number,
) {
  const app = new Hono();

  app.post('/chain/:name', async (c) => {
    const chainName = c.req.param('name');
    const chain = chains.get(chainName);

    if (!chain) {
      return c.json({ error: `Chain "${chainName}" not found` }, 404);
    }

    // Parse optional prompt from body (may be empty body)
    let prompt = 'Say hello in one word.';
    try {
      const body = await c.req.json();
      if (body?.prompt && typeof body.prompt === 'string') {
        prompt = body.prompt;
      }
    } catch {
      // Empty body or invalid JSON — use default prompt
    }

    const testRequest: ChatCompletionRequest = {
      model: '', // overridden per-entry
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 50,
      stream: false,
    };

    logger.info({ chain: chainName, entries: chain.entries.length }, `Chain walk test: "${chainName}"`);

    const results: TestEntryResult[] = [];

    // Test each entry sequentially (NOT waterfall — test every entry)
    for (const entry of chain.entries) {
      const adapter = registry.get(entry.providerId);
      const timeoutMs = adapter.timeout ?? globalTimeoutMs;
      const startTime = performance.now();

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const providerResponse = await adapter.chatCompletion(
          entry.model,
          testRequest,
          controller.signal,
        );

        clearTimeout(timer);

        const latencyMs = Math.round(performance.now() - startTime);
        const content = providerResponse.body.choices[0]?.message?.content ?? '';

        results.push({
          provider: entry.providerId,
          model: entry.model,
          status: 'ok',
          latencyMs,
          response: content.length > 200 ? content.slice(0, 200) + '...' : content,
          tokens: {
            prompt: providerResponse.body.usage?.prompt_tokens ?? 0,
            completion: providerResponse.body.usage?.completion_tokens ?? 0,
            total: providerResponse.body.usage?.total_tokens ?? 0,
          },
        });
      } catch (err: unknown) {
        const latencyMs = Math.round(performance.now() - startTime);
        const errorMessage = err instanceof Error ? err.message : String(err);

        results.push({
          provider: entry.providerId,
          model: entry.model,
          status: 'error',
          latencyMs,
          error: errorMessage,
        });
      }
    }

    const okCount = results.filter((r) => r.status === 'ok').length;

    return c.json({
      chain: chainName,
      results,
      summary: {
        total: results.length,
        ok: okCount,
        failed: results.length - okCount,
      },
    });
  });

  return app;
}
```

**Update `src/index.ts`:**

1. Add import at the top with the other route imports (after `createAdminRoutes`):
   ```typescript
   import { createTestRoutes } from './api/routes/test.js';
   ```

2. After `const adminRoutes = createAdminRoutes(...)` (around line 110), add:
   ```typescript
   const testRoutes = createTestRoutes(chains, registry, config.settings.requestTimeoutMs);
   ```

3. After `v1.route('/admin', adminRoutes);` (around line 116), add:
   ```typescript
   v1.route('/test', testRoutes);
   ```

This mounts the test routes at `/v1/test/*`, so the full path is `POST /v1/test/chain/:name`, behind auth middleware.
  </action>
  <verify>
1. `npx tsc --noEmit` passes — no type errors
2. Read src/api/routes/test.ts and confirm it exports createTestRoutes
3. Read src/index.ts and confirm testRoutes is imported, created, and mounted on v1
  </verify>
  <done>
POST /v1/test/chain/:name endpoint exists, tests each chain entry individually using adapter.chatCompletion(), returns per-entry results with status/latency/response/error, and summary counts. Mounted behind auth middleware at /v1/test.
  </done>
</task>

<task type="auto">
  <name>Task 3: Add chain test UI to Test.tsx</name>
  <files>ui/src/lib/api.ts, ui/src/lib/queryKeys.ts, ui/src/pages/Test.tsx, ui/src/pages/Test.module.css</files>
  <action>
**Update `ui/src/lib/api.ts`:**

Add a new method to the `api` object (after `chatCompletion`):
```typescript
testChain: (chainName: string, prompt?: string) =>
  apiFetch<{
    chain: string;
    results: Array<{
      provider: string;
      model: string;
      status: 'ok' | 'error';
      latencyMs: number;
      response?: string;
      tokens?: { prompt: number; completion: number; total: number };
      error?: string;
    }>;
    summary: { total: number; ok: number; failed: number };
  }>(`/v1/test/chain/${chainName}`, {
    method: 'POST',
    body: JSON.stringify({ prompt: prompt || undefined }),
  }),
```

**Update `ui/src/lib/queryKeys.ts`:**

Add a new key (for invalidation if needed later):
```typescript
chainTest: (name: string) => ['chainTest', name] as const,
```

**Update `ui/src/pages/Test.tsx`:**

Add a second mutation `chainTestMutation` alongside the existing `testMutation`:

```typescript
interface ChainTestResult {
  chain: string;
  results: Array<{
    provider: string;
    model: string;
    status: 'ok' | 'error';
    latencyMs: number;
    response?: string;
    tokens?: { prompt: number; completion: number; total: number };
    error?: string;
  }>;
  summary: { total: number; ok: number; failed: number };
}
```

Create the mutation:
```typescript
const chainTestMutation = useMutation<ChainTestResult, Error, void>({
  mutationFn: async () => {
    const chainName = selectedChain || 'default';
    return api.testChain(chainName, prompt || undefined);
  },
});
```

Add a handler:
```typescript
const handleTestChain = () => {
  chainTestMutation.mutate();
};
```

**In the JSX, add a "Test Chain" button next to the existing "Send" button:**

Place it right after the Send button, inside the same parent container. Use a new CSS class `testChainButton`:
```tsx
<div className={styles.buttonGroup}>
  <button
    className={styles.sendButton}
    onClick={handleSend}
    disabled={testMutation.isPending || chainTestMutation.isPending || !prompt.trim()}
  >
    {testMutation.isPending ? 'Sending...' : 'Send'}
  </button>
  <button
    className={styles.testChainButton}
    onClick={handleTestChain}
    disabled={testMutation.isPending || chainTestMutation.isPending}
  >
    {chainTestMutation.isPending ? 'Testing...' : 'Test Chain'}
  </button>
</div>
```

Wrap both buttons in a `<div className={styles.buttonGroup}>` — replace the standalone send button.

Also disable the chain selector and textarea while either mutation is pending:
```
disabled={testMutation.isPending || chainTestMutation.isPending}
```

**Add chain test results section below the existing response section:**

```tsx
{/* Chain Test Results */}
{(chainTestMutation.data || chainTestMutation.error) && (
  <section className={styles.responseSection}>
    <h2 className={styles.sectionTitle}>Chain Test Results</h2>

    {chainTestMutation.error && (
      <div className={styles.errorContainer}>
        <div className={styles.errorMessage}>
          Error: {chainTestMutation.error.message}
        </div>
      </div>
    )}

    {chainTestMutation.data && (
      <>
        <div className={styles.chainTestSummary}>
          <span className={styles.summaryItem}>
            Chain: <strong>{chainTestMutation.data.chain}</strong>
          </span>
          <span className={styles.summaryItem}>
            Passed: <strong className={styles.okCount}>{chainTestMutation.data.summary.ok}</strong>
            {' / '}
            {chainTestMutation.data.summary.total}
          </span>
          {chainTestMutation.data.summary.failed > 0 && (
            <span className={styles.summaryItem}>
              Failed: <strong className={styles.failedCount}>{chainTestMutation.data.summary.failed}</strong>
            </span>
          )}
        </div>

        <div className={styles.chainTestResults}>
          {chainTestMutation.data.results.map((entry, idx) => (
            <div
              key={idx}
              className={`${styles.chainTestEntry} ${entry.status === 'ok' ? styles.entryOk : styles.entryError}`}
            >
              <div className={styles.entryHeader}>
                <span className={styles.entryStatus}>
                  {entry.status === 'ok' ? 'OK' : 'FAIL'}
                </span>
                <span className={styles.entryProvider}>
                  {entry.provider}/{entry.model}
                </span>
                <span className={styles.entryLatency}>
                  {entry.latencyMs}ms
                </span>
              </div>
              {entry.status === 'ok' && (
                <div className={styles.entryBody}>
                  <div className={styles.entryResponse}>{entry.response}</div>
                  {entry.tokens && (
                    <div className={styles.entryTokens}>
                      {entry.tokens.prompt} + {entry.tokens.completion} = {entry.tokens.total} tokens
                    </div>
                  )}
                </div>
              )}
              {entry.status === 'error' && (
                <div className={styles.entryBody}>
                  <div className={styles.entryErrorText}>{entry.error}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </>
    )}
  </section>
)}
```

**Update `ui/src/pages/Test.module.css`:**

Add these new styles after existing styles:

```css
/* Button Group */
.buttonGroup {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.testChainButton {
  padding: 0.75rem 2rem;
  background: #2d8a4e;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.testChainButton:hover:not(:disabled) {
  background: #236b3e;
}

.testChainButton:disabled {
  background: #ccc;
  cursor: not-allowed;
}

/* Chain Test Summary */
.chainTestSummary {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  margin-bottom: 1rem;
  padding: 0.75rem 1rem;
  background: #f8f9fa;
  border-radius: 4px;
  font-size: 0.9rem;
  color: #555;
}

.summaryItem strong {
  color: #333;
}

.okCount {
  color: #2d8a4e;
}

.failedCount {
  color: #dc3545;
}

/* Chain Test Results */
.chainTestResults {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.chainTestEntry {
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  padding: 0.75rem 1rem;
  border-left: 4px solid #e0e0e0;
}

.entryOk {
  border-left-color: #2d8a4e;
  background: #f6fef8;
}

.entryError {
  border-left-color: #dc3545;
  background: #fff5f5;
}

.entryHeader {
  display: flex;
  align-items: center;
  gap: 1rem;
  font-size: 0.9rem;
}

.entryStatus {
  font-weight: 700;
  font-size: 0.8rem;
  padding: 0.15rem 0.5rem;
  border-radius: 3px;
  text-transform: uppercase;
}

.entryOk .entryStatus {
  background: #d4edda;
  color: #155724;
}

.entryError .entryStatus {
  background: #f8d7da;
  color: #721c24;
}

.entryProvider {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 0.85rem;
  color: #333;
}

.entryLatency {
  margin-left: auto;
  font-size: 0.85rem;
  color: #666;
}

.entryBody {
  margin-top: 0.5rem;
  font-size: 0.85rem;
}

.entryResponse {
  color: #333;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}

.entryTokens {
  margin-top: 0.25rem;
  font-size: 0.8rem;
  color: #888;
}

.entryErrorText {
  color: #dc3545;
  font-weight: 500;
}
```

Make sure when editing Test.tsx you do NOT break the existing testMutation or its results display. The chain test results section should appear as a separate section below the existing response section.
  </action>
  <verify>
1. `cd ui && npx tsc --noEmit` passes — no type errors in UI
2. Read ui/src/pages/Test.tsx and confirm both Send and Test Chain buttons exist
3. Read ui/src/lib/api.ts and confirm testChain method exists
4. Read ui/src/pages/Test.module.css and confirm new chain test styles exist
  </verify>
  <done>
Test page has "Test Chain" button that calls POST /v1/test/chain/:name. Results display shows per-entry cards with green/red color coding, provider/model, latency, response snippet, and token counts. Summary shows pass/fail counts at top. Existing Send functionality unchanged.
  </done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` passes for both backend and UI (no type errors)
2. `POST /v1/test/chain/default` returns JSON with chain, results array, and summary
3. Test page renders both Send and Test Chain buttons
4. docs/USAGE.md contains documentation for all 5 new features plus the test endpoint
</verification>

<success_criteria>
- docs/USAGE.md updated with per-provider timeout, openai type, Moonshot generic-openai, 402 cooldown, float retry-after, and chain walk test endpoint
- POST /v1/test/chain/:name works behind auth, tests each entry individually, returns structured results
- UI Test page has Test Chain button showing color-coded per-entry results with summary
- All TypeScript compiles cleanly
</success_criteria>

<output>
After completion, create `.planning/quick/007-docs-update-chain-test-feature/007-SUMMARY.md`
</output>
