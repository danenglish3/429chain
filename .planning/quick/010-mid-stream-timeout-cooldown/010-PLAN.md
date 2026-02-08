---
phase: quick
plan: 010
type: execute
wave: 1
depends_on: []
files_modified:
  - src/config/schema.ts
  - src/ratelimit/tracker.ts
  - src/api/routes/chat.ts
  - src/index.ts
autonomous: true

must_haves:
  truths:
    - "After N consecutive mid-stream failures on a provider+model, that provider+model enters cooldown and subsequent requests waterfall to next provider"
    - "A single successful stream completion resets the failure counter to zero"
    - "The failure threshold and cooldown duration are configurable via settings"
  artifacts:
    - path: "src/ratelimit/tracker.ts"
      provides: "recordMidStreamFailure() and resetMidStreamFailures() methods"
      contains: "recordMidStreamFailure"
    - path: "src/config/schema.ts"
      provides: "midStreamFailureThreshold and midStreamCooldownMs settings"
      contains: "midStreamFailureThreshold"
    - path: "src/api/routes/chat.ts"
      provides: "Calls to tracker on mid-stream error and successful completion"
      contains: "recordMidStreamFailure"
  key_links:
    - from: "src/api/routes/chat.ts"
      to: "src/ratelimit/tracker.ts"
      via: "tracker.recordMidStreamFailure() in catch block"
      pattern: "tracker\\.recordMidStreamFailure"
    - from: "src/api/routes/chat.ts"
      to: "src/ratelimit/tracker.ts"
      via: "tracker.resetMidStreamFailures() after [DONE]"
      pattern: "tracker\\.resetMidStreamFailures"
---

<objective>
Add mid-stream failure tracking to prevent infinite retry loops when a provider consistently fails mid-stream.

Purpose: Currently, mid-stream timeouts don't trigger any cooldown. A provider can fail mid-stream 10+ times in a row, and clients keep retrying into the same broken provider. After N consecutive mid-stream failures (default 3), the provider+model should be temporarily cooled down so requests waterfall to the next provider.

Output: Modified tracker with failure counting, chat route wired to record/reset failures, two new config settings.
</objective>

<execution_context>
@C:\Users\danen\.claude/get-shit-done/workflows/execute-plan.md
@C:\Users\danen\.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/ratelimit/tracker.ts
@src/api/routes/chat.ts
@src/config/schema.ts
@src/index.ts
@src/config/types.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add mid-stream failure tracking to RateLimitTracker and config schema</name>
  <files>src/config/schema.ts, src/ratelimit/tracker.ts</files>
  <action>
**In `src/config/schema.ts`:** Add two new fields to `SettingsSchema`:
- `midStreamFailureThreshold: z.number().int().min(1).default(3)` -- consecutive mid-stream failures before cooldown
- `midStreamCooldownMs: z.number().int().min(1000).default(30000)` -- cooldown duration in ms (30s)

Add them after `normalizeResponses` in the SettingsSchema object.

**In `src/ratelimit/tracker.ts`:** Add mid-stream failure tracking:

1. Add a new private field: `private midStreamFailures = new Map<string, number>();`
2. Add two new constructor parameters: `midStreamFailureThreshold: number` and `midStreamCooldownMs: number`, stored as private readonly fields. Update the constructor signature to:
   ```typescript
   constructor(
     defaultCooldownMs: number,
     private readonly midStreamFailureThreshold: number = 3,
     private readonly midStreamCooldownMs: number = 30000,
   )
   ```

3. Add `recordMidStreamFailure(providerId: string, model: string): void` method:
   - Get the composite key via `this.key(providerId, model)`
   - Increment the counter in `this.midStreamFailures` (default 0 + 1)
   - If counter >= `this.midStreamFailureThreshold`:
     - Call `this.markExhausted(providerId, model, this.midStreamCooldownMs, 'mid-stream failures exceeded threshold')`
     - Reset the counter to 0 in the map (so after cooldown expires, it starts fresh)
     - Log at `warn` level: `Provider ${providerId}/${model} mid-stream failures (${count}) exceeded threshold (${this.midStreamFailureThreshold}), applying ${this.midStreamCooldownMs}ms cooldown`
   - Else log at `debug` level: `Provider ${providerId}/${model} mid-stream failure ${count}/${this.midStreamFailureThreshold}`

4. Add `resetMidStreamFailures(providerId: string, model: string): void` method:
   - Delete the key from `this.midStreamFailures` map
   - Log at `debug` level only if the key existed (was tracking failures): `Provider ${providerId}/${model} mid-stream failure counter reset`
  </action>
  <verify>
Run `npx tsc --noEmit` -- should compile with no errors. The new config fields should have defaults so existing configs remain valid.
  </verify>
  <done>
RateLimitTracker has recordMidStreamFailure() and resetMidStreamFailures() methods. SettingsSchema has midStreamFailureThreshold (default 3) and midStreamCooldownMs (default 30000). TypeScript compiles cleanly.
  </done>
</task>

<task type="auto">
  <name>Task 2: Wire chat route and index.ts to use mid-stream failure tracking</name>
  <files>src/api/routes/chat.ts, src/index.ts</files>
  <action>
**In `src/index.ts`:** Update the `RateLimitTracker` constructor call (line ~50) to pass the two new settings:
```typescript
const tracker = new RateLimitTracker(
  config.settings.cooldownDefaultMs,
  config.settings.midStreamFailureThreshold,
  config.settings.midStreamCooldownMs,
);
```

**In `src/api/routes/chat.ts`:** Wire mid-stream failure tracking in the streaming branch:

1. **On successful stream completion** (inside the `if (result.done)` block, around line 138-164, BEFORE the `break` statement, AFTER writing `[DONE]` to client):
   Add: `tracker.resetMidStreamFailures(streamResult.providerId, streamResult.model);`

2. **On mid-stream error** (in the `catch (error: unknown)` block, around line 166-202, AFTER the AbortError check, BEFORE the error SSE write):
   Add: `tracker.recordMidStreamFailure(streamResult.providerId, streamResult.model);`
   Place it right after the `logger.error(...)` call on line ~178-186, before the `try { await stream.writeSSE(...)` block.

Do NOT record failures for AbortError (client disconnect) -- the existing early return on AbortError already handles this correctly.
  </action>
  <verify>
1. `npx tsc --noEmit` compiles cleanly
2. `npm test` -- existing tests pass (no breaking changes)
3. Manual verification: review the chat.ts catch block to confirm recordMidStreamFailure is called after the logger.error but before the error SSE write, and NOT called for AbortError
  </verify>
  <done>
- tracker.recordMidStreamFailure() called on every mid-stream error (except client disconnect)
- tracker.resetMidStreamFailures() called on every successful stream completion
- RateLimitTracker receives threshold and cooldown config from settings
- All existing tests pass
  </done>
</task>

</tasks>

<verification>
1. `npx tsc --noEmit` -- full type check passes
2. `npm test` -- all existing tests pass
3. Code review: grep for `recordMidStreamFailure` in chat.ts -- appears in catch block
4. Code review: grep for `resetMidStreamFailures` in chat.ts -- appears in success path after [DONE]
5. Code review: grep for `midStreamFailureThreshold` in schema.ts -- has default(3)
6. Code review: grep for `midStreamCooldownMs` in schema.ts -- has default(30000)
</verification>

<success_criteria>
- After 3 consecutive mid-stream failures on a provider+model, that pair enters a 30s cooldown
- During cooldown, `isExhausted()` returns true for that pair, causing the chain router to skip it
- A successful stream completion resets the failure counter
- Both threshold and cooldown are configurable in YAML settings
- Existing behavior unchanged: pre-stream timeouts still waterfall, client disconnects don't count as failures
</success_criteria>

<output>
After completion, create `.planning/quick/010-mid-stream-timeout-cooldown/010-SUMMARY.md`
</output>
