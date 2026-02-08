---
phase: quick
plan: 009
type: execute
wave: 1
depends_on: []
files_modified:
  - src/shared/logger.ts
  - src/chain/router.ts
  - src/api/routes/chat.ts
  - package.json
autonomous: true

must_haves:
  truths:
    - "Dev terminal shows human-readable timestamps like HH:MM:SS instead of Unix epoch ms"
    - "Waterfall log messages include the next provider being tried"
    - "Mid-stream error log includes which provider failed, what the error was, and what happens next"
    - "Production JSON output is unchanged (pino-pretty only in dev / LOG_FORMAT=pretty)"
  artifacts:
    - path: "src/shared/logger.ts"
      provides: "pino-pretty transport for dev, JSON for production"
      contains: "pino-pretty"
    - path: "src/chain/router.ts"
      provides: "Waterfall messages with next-provider context"
      contains: "next up"
    - path: "src/api/routes/chat.ts"
      provides: "Detailed mid-stream error logs"
      contains: "Mid-stream error"
  key_links:
    - from: "src/shared/logger.ts"
      to: "pino-pretty"
      via: "pino transport config"
      pattern: "pino-pretty"
---

<objective>
Improve terminal log readability for development: add human-friendly timestamps via pino-pretty,
enrich waterfall messages with "next provider" context, and add detail to mid-stream error logs.

Purpose: Raw JSON logs with epoch timestamps are unreadable during development. Waterfall messages
say "waterfalling" but don't say WHERE. Mid-stream errors lack context about what happens next.

Output: Updated logger with pretty-print transport, enriched waterfall messages, better error context.
</objective>

<execution_context>
@C:\Users\danen\.claude/get-shit-done/workflows/execute-plan.md
@C:\Users\danen\.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/shared/logger.ts
@src/chain/router.ts
@src/api/routes/chat.ts
@src/index.ts
@package.json
@src/chain/types.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add pino-pretty dev transport with human timestamps</name>
  <files>package.json, src/shared/logger.ts</files>
  <action>
1. Install pino-pretty as a **regular dependency** (not devDependency -- needed at runtime for transport):
   `npm install pino-pretty`

2. Update `src/shared/logger.ts` to conditionally use pino-pretty transport:
   - Read `LOG_FORMAT` env var. If `LOG_FORMAT=pretty` OR (`NODE_ENV` is not `production` AND `LOG_FORMAT` is not `json`), use pretty transport.
   - When pretty mode is active, configure pino with a transport option:
     ```typescript
     transport: {
       target: 'pino-pretty',
       options: {
         translateTime: 'HH:MM:ss.l',
         ignore: 'pid,hostname',
         colorize: true,
       },
     }
     ```
   - When NOT pretty mode (production / LOG_FORMAT=json), keep current behavior (no transport, raw JSON).
   - Build the pino options object conditionally. The `redact` config must remain in ALL modes.
   - Keep the existing `name`, `level`, and `redact` config unchanged.
   - Use a simple conditional: `const usePretty = process.env['LOG_FORMAT'] === 'pretty' || (process.env['NODE_ENV'] !== 'production' && process.env['LOG_FORMAT'] !== 'json');`
   - Only add the `transport` key when `usePretty` is true.

IMPORTANT: pino-pretty must be a regular dependency (not devDependency) because pino loads transports
dynamically at runtime via worker threads. If it's in devDependencies, production installs with
`--omit=dev` would break if someone sets LOG_FORMAT=pretty. However, since this project uses
tsdown for bundling and the binary runs from dist/, having it in dependencies ensures it's always
available when running from source via `npm run dev`.
  </action>
  <verify>
Run `npm run dev` briefly and confirm logs appear with human-readable timestamps like `HH:MM:ss.123`
instead of `{"time":1770515748796}`. Then set `LOG_FORMAT=json npm run dev` and confirm raw JSON output.
Run `npm run typecheck` to confirm no type errors.
  </verify>
  <done>
Dev mode shows colorized, human-readable logs with HH:MM:ss timestamps. Setting LOG_FORMAT=json
produces raw JSON output. Production (NODE_ENV=production) defaults to JSON.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add next-provider context to waterfall messages and enrich mid-stream errors</name>
  <files>src/chain/router.ts, src/api/routes/chat.ts</files>
  <action>
**router.ts changes:**

In both `executeChain` and `executeStreamChain`, every waterfall log message currently ends with
", waterfalling" or similar. Update these to include the next provider that will be tried.

Implementation approach: Inside the `for` loop, the current entry index is needed. Change both
functions to use indexed iteration: `for (let i = 0; i < chain.entries.length; i++)` with
`const entry = chain.entries[i]!;`. Then compute the next entry:

```typescript
// Find next non-exhausted entry for log context (best-effort, don't pre-check all)
const nextEntry = chain.entries[i + 1];
const nextHint = nextEntry ? ` -> next: ${nextEntry.providerId}/${nextEntry.model}` : ' -> no more providers';
```

Then append `nextHint` to every waterfall log message. Specific messages become:

For `executeChain`:
- 429: `Provider ${id}/${model} returned 429, waterfalling${nextHint}`
- ProviderError: `Provider ${id}/${model} returned ${statusCode}, waterfalling${nextHint}`
- Timeout: `Provider ${id}/${model} timed out after ${timeoutMs}ms, waterfalling (no cooldown)${nextHint}`
- Unknown: `Provider ${id}/${model} failed: ${errorMessage}, waterfalling${nextHint}`

Also add `nextHint` to the structured log object as `next` field:
```typescript
logger.info(
  { provider: entry.providerId, model: entry.model, chain: chain.name, ..., next: nextEntry ? `${nextEntry.providerId}/${nextEntry.model}` : null },
  `Provider ... waterfalling${nextHint}`,
);
```

For `executeStreamChain`: Same pattern -- indexed loop, compute nextEntry, append nextHint to all
waterfall messages (the ones ending in "waterfalling" or "waterfalling (no cooldown)"). Same
structured `next` field in log objects.

DO NOT change the "Skipping ... (on cooldown)" messages -- those are informational, not waterfall actions.
DO NOT change success messages ("Chain served by", "Stream opened from").
DO NOT change the "All providers exhausted" messages.

**chat.ts changes:**

Update the mid-stream error log (line ~179) to be more descriptive:

Current:
```typescript
logger.error(
  { provider: streamResult.providerId, model: streamResult.model, error: errorMessage },
  'Mid-stream error',
);
```

Change to:
```typescript
logger.error(
  {
    provider: streamResult.providerId,
    model: streamResult.model,
    chain: chain.name,
    error: errorMessage,
  },
  `Mid-stream error from ${streamResult.providerId}/${streamResult.model}: ${errorMessage} (stream will close, client must retry)`,
);
```

This tells the operator: which provider, what error, and what happens next (stream closes).
  </action>
  <verify>
1. `npm run typecheck` passes with no errors.
2. `npm test` passes (existing tests should still work; the messages changed but tests likely
   don't assert on exact log message strings).
3. Grep router.ts for "waterfalling" -- every occurrence should now include `${nextHint}`.
4. Grep chat.ts for "Mid-stream error" -- should include provider/model/error detail.
  </verify>
  <done>
All waterfall log messages include the next provider in the chain (e.g. "waterfalling -> next:
groq/llama-3.1-8b-instant" or "waterfalling -> no more providers"). Mid-stream error log includes
provider name, error details, and indicates the stream will close.
  </done>
</task>

</tasks>

<verification>
1. `npm run typecheck` -- no type errors
2. `npm test` -- all tests pass
3. Start dev server (`npm run dev`), send a request, observe:
   - Timestamps are human-readable (HH:MM:ss format)
   - Logs are colorized and readable
   - If a waterfall occurs, log shows next provider
4. `LOG_FORMAT=json npm run dev` -- confirm raw JSON output still works
</verification>

<success_criteria>
- Dev logs show human-readable timestamps (HH:MM:ss.l format) with colorized output
- Production/JSON mode unchanged (raw JSON, epoch timestamps)
- Every waterfall message includes "-> next: provider/model" or "-> no more providers"
- Mid-stream error log includes provider, error message, and consequence
- All existing tests pass, no type errors
</success_criteria>

<output>
After completion, create `.planning/quick/009-improve-terminal-log-formatting/009-SUMMARY.md`
</output>
