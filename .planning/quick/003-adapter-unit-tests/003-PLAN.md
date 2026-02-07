---
phase: quick
plan: 003
type: execute
wave: 1
depends_on: []
files_modified:
  - src/providers/adapters/__tests__/groq.test.ts
  - src/providers/adapters/__tests__/openrouter.test.ts
  - src/providers/adapters/__tests__/cerebras.test.ts
  - src/providers/adapters/__tests__/generic-openai.test.ts
  - src/providers/__tests__/base-adapter.test.ts
autonomous: true

must_haves:
  truths:
    - "Each adapter correctly parses its provider-specific rate limit headers into normalized RateLimitInfo"
    - "Each adapter returns null when no recognized headers are present"
    - "Groq parseDurationToMs correctly handles all duration formats (hours, minutes, seconds, milliseconds, combinations)"
    - "OpenRouter getExtraHeaders returns HTTP-Referer and X-Title"
    - "Cerebras prepareRequestBody strips presence_penalty and frequency_penalty while preserving other params"
    - "BaseAdapter chatCompletion throws ProviderRateLimitError on 429 and ProviderError on other non-OK statuses"
    - "BaseAdapter chatCompletionStream throws the same errors on 429 and non-OK statuses"
  artifacts:
    - path: "src/providers/adapters/__tests__/groq.test.ts"
      provides: "Tests for parseDurationToMs and GroqAdapter.parseRateLimitHeaders"
    - path: "src/providers/adapters/__tests__/openrouter.test.ts"
      provides: "Tests for OpenRouterAdapter getExtraHeaders and parseRateLimitHeaders"
    - path: "src/providers/adapters/__tests__/cerebras.test.ts"
      provides: "Tests for CerebrasAdapter prepareRequestBody and parseRateLimitHeaders"
    - path: "src/providers/adapters/__tests__/generic-openai.test.ts"
      provides: "Tests for GenericOpenAIAdapter parseRateLimitHeaders"
    - path: "src/providers/__tests__/base-adapter.test.ts"
      provides: "Tests for BaseAdapter chatCompletion/chatCompletionStream error handling"
  key_links:
    - from: "src/providers/adapters/__tests__/groq.test.ts"
      to: "src/providers/adapters/groq.ts"
      via: "import { parseDurationToMs, GroqAdapter }"
      pattern: "parseDurationToMs|GroqAdapter"
    - from: "src/providers/__tests__/base-adapter.test.ts"
      to: "src/providers/base-adapter.ts"
      via: "Uses GroqAdapter as concrete instance to test abstract BaseAdapter methods"
      pattern: "chatCompletion|chatCompletionStream"
---

<objective>
Add comprehensive unit tests for all four provider adapters (groq, openrouter, cerebras, generic-openai) and the abstract BaseAdapter class.

Purpose: The adapter layer has zero test coverage. These are pure functions and header parsers with well-defined inputs and outputs -- ideal unit test targets. The base adapter's HTTP logic (429 detection, error handling, request preparation) also needs coverage.
Output: Five test files covering all adapter behavior with ~35 test cases total.
</objective>

<execution_context>
@C:\Users\danen\.claude/get-shit-done/workflows/execute-plan.md
@C:\Users\danen\.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/providers/adapters/groq.ts
@src/providers/adapters/openrouter.ts
@src/providers/adapters/cerebras.ts
@src/providers/adapters/generic-openai.ts
@src/providers/base-adapter.ts
@src/providers/types.ts
@src/shared/errors.ts
@src/shared/types.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create unit tests for the four adapter classes</name>
  <files>
    src/providers/adapters/__tests__/groq.test.ts
    src/providers/adapters/__tests__/openrouter.test.ts
    src/providers/adapters/__tests__/cerebras.test.ts
    src/providers/adapters/__tests__/generic-openai.test.ts
  </files>
  <action>
Create four test files in `src/providers/adapters/__tests__/`. Use vitest with `describe`/`it`/`expect` (globals: true in vitest config). Follow the project's existing test style from `src/chain/__tests__/router.test.ts`.

**src/providers/adapters/__tests__/groq.test.ts:**

Test `parseDurationToMs` (exported function):
- `"6m23.456s"` -> 383456
- `"1.5s"` -> 1500
- `"2m0s"` -> 120000
- `"0s"` -> 0
- `"500ms"` -> 500
- `"2h30m0s"` -> 9000000
- `"10s"` -> 10000

Test `GroqAdapter.parseRateLimitHeaders`:
- All 7 headers present: Create `new Headers()` with `x-ratelimit-limit-requests: "14400"`, `x-ratelimit-remaining-requests: "14399"`, `x-ratelimit-reset-requests: "6m23.456s"`, `x-ratelimit-limit-tokens: "18000"`, `x-ratelimit-remaining-tokens: "17500"`, `x-ratelimit-reset-tokens: "1.5s"`, `retry-after: "8.12"`. Assert result has `limitRequests: 14400`, `remainingRequests: 14399`, `resetRequestsMs: 383456`, `limitTokens: 18000`, `remainingTokens: 17500`, `resetTokensMs: 1500`, `retryAfterMs: 8120`.
- No headers present: `new Headers()` -> returns `null`.
- Partial headers: Only `x-ratelimit-limit-requests: "100"` and `retry-after: "5"` -> returns `{ limitRequests: 100, retryAfterMs: 5000 }` and other fields are undefined.

Test constructor default base URL: `new GroqAdapter('test', 'Test', 'key').baseUrl` equals `'https://api.groq.com/openai/v1'`.

**src/providers/adapters/__tests__/openrouter.test.ts:**

Test `getExtraHeaders`:
- Returns `{ 'HTTP-Referer': '429chain', 'X-Title': '429chain' }`.

Test `parseRateLimitHeaders`:
- All 3 headers: `X-RateLimit-Limit: "100"`, `X-RateLimit-Remaining: "95"`, `X-RateLimit-Reset: "{futureTimestampMs}"`. Use `vi.spyOn(Date, 'now').mockReturnValue(1000000)` and set reset to `"1060000"` (60 seconds in future). Assert `limitRequests: 100`, `remainingRequests: 95`, `resetRequestsMs: 60000`. Restore Date.now after.
- No headers: returns `null`.
- Reset in the past: Set reset timestamp to a value less than Date.now() mock. Assert `resetRequestsMs: 0` (clamped via Math.max(0, ...)).

Test constructor default base URL: `'https://openrouter.ai/api/v1'`.

**src/providers/adapters/__tests__/cerebras.test.ts:**

Test `prepareRequestBody` (protected method -- test via public behavior):
Since `prepareRequestBody` is `protected`, test it indirectly by mocking `fetch` and inspecting the request body sent by `chatCompletion`. Use `vi.stubGlobal('fetch', vi.fn())` to mock fetch, then call `adapter.chatCompletion('llama-70b', requestBody)` and inspect what body was passed to fetch.

- Strips presence_penalty and frequency_penalty: Pass a request body with `{ model: 'ignored', messages: [...], temperature: 0.7, presence_penalty: 0.5, frequency_penalty: 0.3 }`. Mock fetch to return `new Response(JSON.stringify(validResponseBody), { status: 200 })`. After calling `chatCompletion`, inspect the fetch mock's call args: `JSON.parse(fetchMock.mock.calls[0][1].body)`. Assert it has `model: 'llama-70b'`, `temperature: 0.7`, `stream: false`, and does NOT have `presence_penalty` or `frequency_penalty` properties.
- Preserves other params: Same approach. Assert `temperature`, `messages`, `max_tokens` are present.

Use `afterEach(() => vi.unstubAllGlobals())` to clean up.

Test `parseRateLimitHeaders`:
- All 6 day/minute headers: `x-ratelimit-limit-requests-day: "1000"`, `x-ratelimit-remaining-requests-day: "950"`, `x-ratelimit-reset-requests-day: "3600"` (seconds), `x-ratelimit-limit-tokens-minute: "60000"`, `x-ratelimit-remaining-tokens-minute: "55000"`, `x-ratelimit-reset-tokens-minute: "45"`. Assert `limitRequests: 1000`, `remainingRequests: 950`, `resetRequestsMs: 3600000`, `limitTokens: 60000`, `remainingTokens: 55000`, `resetTokensMs: 45000`.
- No headers: returns `null`.

Test constructor default base URL: `'https://api.cerebras.ai/v1'`.

**src/providers/adapters/__tests__/generic-openai.test.ts:**

Test `parseRateLimitHeaders`:
- All 5 headers: `x-ratelimit-limit-requests: "500"`, `x-ratelimit-remaining-requests: "499"`, `x-ratelimit-limit-tokens: "100000"`, `x-ratelimit-remaining-tokens: "99000"`, `retry-after: "2.5"`. Assert `limitRequests: 500`, `remainingRequests: 499`, `limitTokens: 100000`, `remainingTokens: 99000`, `retryAfterMs: 2500`.
- No headers: returns `null`.
- Partial headers: Only `retry-after: "10"` -> returns `{ retryAfterMs: 10000 }`, other fields are undefined.

Test constructor requires baseUrl (no default): `new GenericOpenAIAdapter('test', 'Test', 'key', 'https://custom.api.com/v1').baseUrl` equals `'https://custom.api.com/v1'`.

For all test files, import from the source using relative `.js` extension paths (ESM convention), e.g., `import { parseDurationToMs, GroqAdapter } from '../groq.js'`.
  </action>
  <verify>Run `npx vitest run src/providers/adapters/__tests__/` -- all tests pass.</verify>
  <done>Four test files exist covering: Groq duration parsing (7 cases) + header parsing (3 cases) + default URL; OpenRouter extra headers + header parsing (3 cases) + default URL; Cerebras param stripping (2 cases) + header parsing (2 cases) + default URL; GenericOpenAI header parsing (3 cases) + URL requirement.</done>
</task>

<task type="auto">
  <name>Task 2: Create unit tests for BaseAdapter HTTP behavior</name>
  <files>src/providers/__tests__/base-adapter.test.ts</files>
  <action>
Create `src/providers/__tests__/base-adapter.test.ts`. Since `BaseAdapter` is abstract, use `GroqAdapter` as the concrete implementation (simplest adapter with no body modifications). Mock `fetch` globally with `vi.stubGlobal('fetch', mockFetch)` and clean up with `vi.unstubAllGlobals()` in `afterEach`.

Create helpers at the top:
```ts
function makeValidResponse(): ChatCompletionResponse {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'test-model',
    choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
  };
}

function makeRequest(): ChatCompletionRequest {
  return { model: 'test-model', messages: [{ role: 'user', content: 'Hi' }] };
}
```

Import `ProviderRateLimitError` and `ProviderError` from `../../shared/errors.js`. Import `GroqAdapter` from `../adapters/groq.js`. Import types from `../../shared/types.js`.

**Tests for chatCompletion (non-streaming):**

`describe('BaseAdapter.chatCompletion', () => { ... })`:

1. "returns ProviderResponse on 200": Mock fetch to return `new Response(JSON.stringify(makeValidResponse()), { status: 200 })`. Call `adapter.chatCompletion('test-model', makeRequest())`. Assert result has `status: 200`, `body.object === 'chat.completion'`, `latencyMs` is a number >= 0, `headers` is a Headers instance.

2. "throws ProviderRateLimitError on 429": Mock fetch to return `new Response('rate limited', { status: 429 })`. Call `adapter.chatCompletion(...)`. Expect it to throw. Catch the error and assert: `error instanceof ProviderRateLimitError`, `error.statusCode === 429`, `error.providerId` matches adapter id, `error.headers` is a Headers instance.

3. "throws ProviderError on non-OK non-429 (500)": Mock fetch to return `new Response('Internal Server Error', { status: 500 })`. Assert throws `ProviderError` with `statusCode === 500`.

4. "throws ProviderError on 401": Mock fetch to return `new Response('Unauthorized', { status: 401 })`. Assert throws `ProviderError` with `statusCode === 401`.

5. "sends correct headers (Authorization + Content-Type)": Mock fetch to return 200. Call `chatCompletion`. Inspect `fetchMock.mock.calls[0][1].headers`. Assert it includes `Authorization: 'Bearer test-api-key'` and `Content-Type: 'application/json'`.

6. "sends POST to {baseUrl}/chat/completions": Mock fetch 200. Call. Assert `fetchMock.mock.calls[0][0]` equals `'https://api.groq.com/openai/v1/chat/completions'`.

**Tests for chatCompletionStream:**

`describe('BaseAdapter.chatCompletionStream', () => { ... })`:

1. "returns Response on 200": Mock fetch to return `new Response('data: test', { status: 200 })`. Call `adapter.chatCompletionStream('test-model', makeRequest())`. Assert result is a Response with `status === 200`.

2. "throws ProviderRateLimitError on 429": Mock fetch to return 429. Assert throws `ProviderRateLimitError`.

3. "throws ProviderError on 500": Mock fetch to return 500. Assert throws `ProviderError`.

4. "forces stream: true in request body": Mock fetch 200. Call `chatCompletionStream`. Inspect `JSON.parse(fetchMock.mock.calls[0][1].body)`. Assert `stream === true`.

**Tests for prepareRequestBody (via chatCompletion inspection):**

`describe('BaseAdapter.prepareRequestBody', () => { ... })`:

1. "replaces model and sets stream: false": Mock fetch 200. Call `chatCompletion('override-model', { model: 'original', messages: [...] })`. Inspect fetch body. Assert `model === 'override-model'` and `stream === false`.

2. "preserves additional request fields": Pass body with `temperature: 0.8`, `max_tokens: 100`. Inspect fetch body. Assert both fields are present with correct values.

Create the adapter in a `beforeEach`: `adapter = new GroqAdapter('test-provider', 'Test Provider', 'test-api-key')`.

Use `afterEach(() => { vi.unstubAllGlobals(); })` to restore fetch.
  </action>
  <verify>Run `npx vitest run src/providers/__tests__/base-adapter.test.ts` -- all tests pass.</verify>
  <done>BaseAdapter test file exists with ~12 tests covering: chatCompletion success/429/500/401 responses and correct HTTP method/headers; chatCompletionStream success/429/500 and stream:true enforcement; prepareRequestBody model replacement and field preservation.</done>
</task>

</tasks>

<verification>
1. `npx vitest run src/providers/` -- all tests across all 5 new test files pass
2. `npx vitest run` -- full test suite passes (no regressions in existing tests)
3. `npx tsc --noEmit` -- no type errors in test files
</verification>

<success_criteria>
- Five test files created in the correct `__tests__/` directories
- All four adapter header parsers have tests for full headers, no headers, and partial/edge cases
- Groq parseDurationToMs tested with 7 format variations
- Cerebras parameter stripping tested via fetch mock inspection
- OpenRouter getExtraHeaders tested
- BaseAdapter chatCompletion/chatCompletionStream tested for 200, 429, and 500 responses
- Full test suite (`npx vitest run`) passes with zero failures
</success_criteria>

<output>
After completion, create `.planning/quick/003-adapter-unit-tests/003-SUMMARY.md`
</output>
