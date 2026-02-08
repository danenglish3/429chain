---
phase: quick
plan: 008
type: execute
wave: 1
depends_on: []
files_modified:
  - src/config/schema.ts
  - src/shared/types.ts
  - src/shared/normalize.ts
  - src/shared/__tests__/normalize.test.ts
  - src/api/routes/chat.ts
  - src/index.ts
  - config/config.example.yaml
autonomous: true

must_haves:
  truths:
    - "When normalizeResponses is false (default), responses pass through unchanged — existing behavior preserved"
    - "When normalizeResponses is true, non-streaming responses with reasoning_content have it moved to content"
    - "When normalizeResponses is true, streaming chunks with delta.reasoning_content have it moved to delta.content"
    - "If content already has a value, reasoning_content is NOT overwritten into content"
  artifacts:
    - path: "src/shared/normalize.ts"
      provides: "normalizeResponse and normalizeChunk pure functions"
      exports: ["normalizeResponse", "normalizeChunk"]
    - path: "src/shared/__tests__/normalize.test.ts"
      provides: "Unit tests for both normalize functions"
    - path: "src/config/schema.ts"
      provides: "normalizeResponses field in SettingsSchema"
      contains: "normalizeResponses"
  key_links:
    - from: "src/api/routes/chat.ts"
      to: "src/shared/normalize.ts"
      via: "import { normalizeResponse, normalizeChunk }"
      pattern: "normalizeResponse|normalizeChunk"
    - from: "src/index.ts"
      to: "createChatRoutes"
      via: "passes normalizeResponses boolean from config.settings"
      pattern: "normalizeResponses"
---

<objective>
Add a `normalizeResponses` config flag (default: false) that when enabled, moves `reasoning_content` into `content` in provider responses. This ensures downstream consumers always see reasoning model output in the standard `content` field.

Purpose: DeepSeek R1 and similar reasoning models return thinking output in a non-standard `reasoning_content` field. Consumers that only read `content` miss this output entirely. This flag lets users opt in to normalization.

Output: New config flag, pure normalize utility functions with tests, wired into both streaming and non-streaming chat paths.
</objective>

<execution_context>
@C:\Users\danen\.claude/get-shit-done/workflows/execute-plan.md
@C:\Users\danen\.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/config/schema.ts
@src/shared/types.ts
@src/api/routes/chat.ts
@src/index.ts
@config/config.example.yaml
@src/shared/__tests__/errors.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add normalizeResponses config flag and create normalize utility with tests</name>
  <files>
    src/config/schema.ts
    src/shared/types.ts
    src/shared/normalize.ts
    src/shared/__tests__/normalize.test.ts
    config/config.example.yaml
  </files>
  <action>
**1. Schema (`src/config/schema.ts`):**
Add `normalizeResponses: z.boolean().default(false)` to `SettingsSchema`, after the `dbPath` field.

**2. Types (`src/shared/types.ts`):**
Add an optional `reasoning_content?: string` field to:
- `ChatMessage.message` — no, `ChatMessage` is the request type. The response message type is inline in `ChatCompletionChoice`. Add `reasoning_content?: string` to the `message` object type inside `ChatCompletionChoice` (alongside `content`, `role`, `tool_calls`).
- `ChatCompletionDelta` — add `reasoning_content?: string` alongside `content`.

This gives TypeScript visibility into the field for the normalize functions.

**3. Normalize utility (`src/shared/normalize.ts`):**
Create NEW file with two exported pure functions:

```typescript
import type { ChatCompletionResponse, ChatCompletionChunk } from './types.js';
```

`normalizeResponse(response: ChatCompletionResponse): ChatCompletionResponse`
- Iterate `response.choices`
- For each choice: if `choice.message.reasoning_content` exists (truthy string) AND `choice.message.content` is null, undefined, or empty string:
  - Set `choice.message.content = choice.message.reasoning_content`
  - Delete `choice.message.reasoning_content`
- If `choice.message.content` already has a non-empty value, leave both fields as-is (do NOT overwrite real content)
- Returns the same response object (mutates in place for efficiency, no deep clone needed)

`normalizeChunk(data: string): string`
- If `data` is `[DONE]`, return it unchanged
- Try to `JSON.parse(data)` as `ChatCompletionChunk`
- Iterate `parsed.choices`
- For each choice: if `choice.delta.reasoning_content` exists (truthy string) AND `choice.delta.content` is null or undefined:
  - Set `choice.delta.content = choice.delta.reasoning_content`
  - Delete `choice.delta.reasoning_content`
- Return `JSON.stringify(parsed)`
- Wrap entire function body in try-catch: on any error, return original `data` string unchanged (defensive — never break streaming)

**4. Tests (`src/shared/__tests__/normalize.test.ts`):**
Use Vitest (import { describe, it, expect } from 'vitest'). Follow the test style in `errors.test.ts`.

`describe('normalizeResponse')`:
- "moves reasoning_content to content when content is null": Create a response with `choices[0].message = { role: 'assistant', content: null, reasoning_content: 'thinking...' }`. After normalize, content should be 'thinking...' and reasoning_content should be undefined.
- "moves reasoning_content to content when content is empty string": Same but `content: ''`.
- "does NOT overwrite existing content": `content: 'real answer', reasoning_content: 'thinking...'`. After normalize, content is still 'real answer' and reasoning_content is still 'thinking...' (both preserved).
- "no-ops when reasoning_content is absent": Normal response with no reasoning_content field. Returns unchanged.
- "handles multiple choices": Two choices, first has reasoning_content, second is normal. Only first is transformed.

`describe('normalizeChunk')`:
- "moves delta.reasoning_content to delta.content when content is null/undefined": JSON chunk with `delta: { reasoning_content: 'step 1' }`. After normalize, delta.content is 'step 1', reasoning_content gone.
- "does NOT overwrite existing delta.content": `delta: { content: 'answer', reasoning_content: 'think' }`. Unchanged.
- "returns [DONE] unchanged": Input `'[DONE]'`, output `'[DONE]'`.
- "returns malformed JSON unchanged": Input `'not json'`, output `'not json'`.
- "handles chunk with no choices gracefully": Valid JSON but empty choices array. Returns valid JSON unchanged.

**5. Example config (`config/config.example.yaml`):**
Add `normalizeResponses: false` to the settings block with a comment:
```yaml
  normalizeResponses: false   # Move reasoning_content to content for reasoning models (e.g. DeepSeek R1)
```
Place it after `requestTimeoutMs`.
  </action>
  <verify>
Run `npx vitest run src/shared/__tests__/normalize.test.ts` — all tests pass.
Run `npx vitest run src/config/__tests__/` — existing config tests still pass (new field has a default so existing fixtures remain valid).
  </verify>
  <done>
normalizeResponse and normalizeChunk are implemented, tested (9+ test cases passing), config schema accepts the new field with default false, example config updated.
  </done>
</task>

<task type="auto">
  <name>Task 2: Wire normalize functions into chat route for both streaming and non-streaming paths</name>
  <files>
    src/api/routes/chat.ts
    src/index.ts
  </files>
  <action>
**1. Update `createChatRoutes` signature (`src/api/routes/chat.ts`):**
Add a 7th parameter `normalizeResponses: boolean` after `globalTimeoutMs`. Update the JSDoc to document it.

**2. Import normalize functions:**
Add at the top of chat.ts:
```typescript
import { normalizeResponse, normalizeChunk } from '../../shared/normalize.js';
```

**3. Non-streaming path (around line 231, `return c.json(result.response)`):**
Before `return c.json(result.response)`, add:
```typescript
if (normalizeResponses) {
  normalizeResponse(result.response);
}
return c.json(result.response);
```

**4. Streaming path (around line 130, inside the `for (const data of result.events)` loop):**
Before `await stream.writeSSE({ data })` (line 130), apply normalization to each chunk:
```typescript
const normalizedData = normalizeResponses ? normalizeChunk(data) : data;
```
Then change the writeSSE call to use `normalizedData`:
```typescript
await stream.writeSSE({ data: normalizedData });
```

IMPORTANT: The usage capture block (lines 121-128) that parses JSON to extract `parsed.usage` should run on the ORIGINAL `data`, not the normalized version, so that usage capture is unaffected. The normalization only changes the data sent to the client. Keep the usage capture try-catch BEFORE normalization. The order should be:
1. Usage capture from `data` (existing code, unchanged)
2. Normalize: `const normalizedData = normalizeResponses ? normalizeChunk(data) : data;`
3. Write: `await stream.writeSSE({ data: normalizedData });`

**5. Update call site (`src/index.ts`):**
On line 101, add `config.settings.normalizeResponses` as the 7th argument:
```typescript
const chatRoutes = createChatRoutes(
  chains, tracker, registry, config.settings.defaultChain,
  requestLogger, config.settings.requestTimeoutMs,
  config.settings.normalizeResponses,
);
```
  </action>
  <verify>
Run `npx vitest run` — full test suite passes (no regressions).
Run `npx tsc --noEmit` — type check passes.
Manually verify: grep for `normalizeResponses` in chat.ts and index.ts to confirm wiring is present.
  </verify>
  <done>
normalizeResponses flag flows from config through to both streaming and non-streaming chat paths. When false (default), zero behavioral change. When true, reasoning_content is moved to content before responses reach the client.
  </done>
</task>

</tasks>

<verification>
1. `npx vitest run` — all tests pass including new normalize tests
2. `npx tsc --noEmit` — no type errors
3. `npx tsdown` (or project build command) — builds successfully
4. Config with `normalizeResponses: true` parses without error
5. Config without `normalizeResponses` parses (defaults to false)
</verification>

<success_criteria>
- normalizeResponses config flag exists with default false
- normalizeResponse handles non-streaming responses (moves reasoning_content to content when content is empty)
- normalizeChunk handles streaming chunks (same logic, with defensive try-catch)
- Both functions preserve existing content (never overwrite non-empty content)
- Chat route applies normalization only when flag is true
- All existing tests continue to pass (no regressions)
- 9+ new unit tests pass for normalize functions
</success_criteria>

<output>
After completion, create `.planning/quick/008-normalize-reasoning-content/008-SUMMARY.md`
</output>
