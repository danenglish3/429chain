---
phase: quick
plan: 006
type: execute
wave: 1
depends_on: []
files_modified:
  - src/providers/utils.ts
  - src/providers/adapters/groq.ts
  - src/providers/adapters/openai.ts
  - src/providers/registry.ts
  - src/config/schema.ts
  - src/providers/adapters/__tests__/groq.test.ts
  - src/providers/adapters/__tests__/openai.test.ts
  - config/config.example.yaml
  - docs/USAGE.md
  - docs/PROVIDERS.md
autonomous: true

must_haves:
  truths:
    - "Config with type 'openai' validates and creates OpenAIAdapter"
    - "OpenAI adapter parses all 6 rate limit headers + retry-after using Go duration format"
    - "parseDurationToMs is shared between Groq and OpenAI adapters without duplication"
    - "Config example shows OpenAI and Moonshot (generic-openai) as fallback chain entries"
  artifacts:
    - path: "src/providers/utils.ts"
      provides: "Shared parseDurationToMs utility"
      exports: ["parseDurationToMs"]
    - path: "src/providers/adapters/openai.ts"
      provides: "OpenAI adapter with rate limit header parsing"
      exports: ["OpenAIAdapter"]
    - path: "src/providers/adapters/__tests__/openai.test.ts"
      provides: "OpenAI adapter unit tests"
  key_links:
    - from: "src/providers/adapters/openai.ts"
      to: "src/providers/utils.ts"
      via: "import parseDurationToMs"
      pattern: "import.*parseDurationToMs.*from.*utils"
    - from: "src/providers/adapters/groq.ts"
      to: "src/providers/utils.ts"
      via: "import parseDurationToMs (re-exported for backward compat)"
      pattern: "import.*parseDurationToMs.*from.*utils"
    - from: "src/providers/registry.ts"
      to: "src/providers/adapters/openai.ts"
      via: "import and switch case"
      pattern: "case 'openai'"
    - from: "src/config/schema.ts"
      to: "type enum"
      via: "z.enum includes 'openai'"
      pattern: "openai.*generic-openai"
---

<objective>
Add OpenAI as a first-class provider type with proper rate limit header parsing, and document Moonshot as a generic-openai provider. Extract parseDurationToMs to a shared utility to avoid code duplication between Groq and OpenAI adapters.

Purpose: OpenAI uses the same Go time.Duration format for reset headers as Groq. Making it first-class gives proper parsing of all 6 rate limit headers + retry-after, which generic-openai would miss (generic-openai doesn't parse reset duration strings).
Output: Working openai provider type, updated config example with OpenAI + Moonshot fallbacks, updated docs.
</objective>

<execution_context>
@C:\Users\danen\.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@src/providers/base-adapter.ts
@src/providers/adapters/groq.ts
@src/providers/adapters/generic-openai.ts
@src/providers/registry.ts
@src/config/schema.ts
@src/providers/adapters/__tests__/groq.test.ts
@config/config.example.yaml
@docs/USAGE.md
@docs/PROVIDERS.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extract parseDurationToMs + Create OpenAI adapter + Wire registry/schema</name>
  <files>
    src/providers/utils.ts
    src/providers/adapters/groq.ts
    src/providers/adapters/openai.ts
    src/providers/registry.ts
    src/config/schema.ts
  </files>
  <action>
1. Create `src/providers/utils.ts`:
   - Move the `parseDurationToMs` function from `src/providers/adapters/groq.ts` into this file.
   - Export it as a named export.
   - Keep the exact same implementation and JSDoc comment.

2. Update `src/providers/adapters/groq.ts`:
   - Remove the `parseDurationToMs` function body.
   - Add `import { parseDurationToMs } from '../utils.js';` at the top.
   - KEEP the re-export: `export { parseDurationToMs } from '../utils.js';` so that existing imports from groq.ts (including tests) don't break.

3. Create `src/providers/adapters/openai.ts`:
   - Follow the exact pattern of groq.ts adapter.
   - `const DEFAULT_BASE_URL = 'https://api.openai.com/v1';`
   - `import { parseDurationToMs } from '../utils.js';`
   - `import { BaseAdapter } from '../base-adapter.js';`
   - `import type { RateLimitInfo } from '../types.js';`
   - Constructor: `constructor(id: string, name: string, apiKey: string, baseUrl?: string, timeout?: number)` calling `super(id, 'openai', name, apiKey, baseUrl ?? DEFAULT_BASE_URL, timeout)`.
   - `parseRateLimitHeaders`: Parse ALL 7 headers identical to Groq's implementation (they use the same header names and duration format):
     - `x-ratelimit-limit-requests` -> limitRequests (parseInt)
     - `x-ratelimit-remaining-requests` -> remainingRequests (parseInt)
     - `x-ratelimit-reset-requests` -> resetRequestsMs (parseDurationToMs)
     - `x-ratelimit-limit-tokens` -> limitTokens (parseInt)
     - `x-ratelimit-remaining-tokens` -> remainingTokens (parseInt)
     - `x-ratelimit-reset-tokens` -> resetTokensMs (parseDurationToMs)
     - `retry-after` -> retryAfterMs (parseFloat * 1000, only on 429)
   - Return null if all 7 headers are null.
   - No getExtraHeaders override needed. No prepareRequestBody override needed.

4. Update `src/config/schema.ts`:
   - Change `z.enum(['openrouter', 'groq', 'cerebras', 'generic-openai'])` to `z.enum(['openrouter', 'groq', 'cerebras', 'openai', 'generic-openai'])`.

5. Update `src/providers/registry.ts`:
   - Add import: `import { OpenAIAdapter } from './adapters/openai.js';`
   - Add case BEFORE `'generic-openai'` in the switch:
     ```
     case 'openai':
       return new OpenAIAdapter(config.id, config.name, config.apiKey, config.baseUrl, config.timeout);
     ```
   - Update the error message in the default case to include 'openai' in the supported types list.
  </action>
  <verify>
    Run `npx vitest run` — all existing tests pass (groq tests still import parseDurationToMs from groq.ts via re-export).
  </verify>
  <done>
    OpenAI adapter exists, schema accepts 'openai' type, registry creates OpenAIAdapter, parseDurationToMs lives in shared utils.ts, all existing tests still pass.
  </done>
</task>

<task type="auto">
  <name>Task 2: Tests + Config example + Docs</name>
  <files>
    src/providers/adapters/__tests__/openai.test.ts
    config/config.example.yaml
    docs/USAGE.md
    docs/PROVIDERS.md
  </files>
  <action>
1. Create `src/providers/adapters/__tests__/openai.test.ts` following the groq.test.ts pattern:
   - `import { OpenAIAdapter } from '../openai.js';`
   - `describe('OpenAIAdapter')` with:
     - `describe('constructor')`:
       - 'sets default base URL when not provided' -> expect `https://api.openai.com/v1`
       - 'uses provided base URL when given' -> custom URL
     - `describe('parseRateLimitHeaders')`:
       - 'parses all 7 headers correctly' — use same header names as groq test but different values (e.g., limitRequests: 10000, remainingRequests: 9999, resetRequests: '2m30s' -> 150000, limitTokens: 200000, remainingTokens: 195000, resetTokens: '45.5s' -> 45500, retryAfter: '3.5' -> 3500)
       - 'returns null when no headers are present'
       - 'parses partial headers correctly' — just limit-requests + retry-after

2. Update `config/config.example.yaml`:
   - Add two new provider entries after cerebras:
     ```yaml
       - id: openai
         name: OpenAI
         type: openai
         apiKey: "sk-your-openai-key-here"
         # baseUrl defaults to https://api.openai.com/v1

       - id: moonshot
         name: Moonshot
         type: generic-openai
         apiKey: "sk-your-moonshot-key-here"
         baseUrl: "https://api.moonshot.ai/v1"
     ```
   - Update the `default` chain entries to add openai and moonshot as paid fallbacks after cerebras:
     ```yaml
       - provider: openai        # paid fallback
         model: "gpt-4o-mini"
       - provider: moonshot       # paid fallback
         model: "kimi-k2-0711-preview"
     ```
   - Update the `fast` chain to remain as-is (groq + cerebras only, free tier).

3. Update `docs/USAGE.md`:
   - In section 3.2 Providers, update the `type` field description: change enum from `openrouter, groq, cerebras, generic-openai` to `openrouter, groq, cerebras, openai, generic-openai`.
   - In the Provider Types list, add between cerebras and generic-openai:
     `- \`openai\` - OpenAI API (default baseUrl: https://api.openai.com/v1)`
   - In the example YAML under section 3.2, add the openai provider entry.
   - In section 3.4 Full Example Configuration, update to match the new config.example.yaml (add openai + moonshot providers and chain entries).

4. Update `docs/PROVIDERS.md`:
   - In the "Quick Path: generic-openai" -> "Examples" section, add Moonshot:
     `- **Moonshot AI**: \`https://api.moonshot.ai/v1\``
   - In Step 5a registry example code, add the openai case.
   - In Step 5b schema example code, add 'openai' to the z.enum.
   - Update the checklist's error message note to include 'openai'.
  </action>
  <verify>
    Run `npx vitest run` — all tests pass including new openai.test.ts.
  </verify>
  <done>
    OpenAI adapter has full test coverage (constructor defaults, all/no/partial headers). Config example shows OpenAI + Moonshot. USAGE.md and PROVIDERS.md reference OpenAI as first-class and Moonshot as generic-openai example.
  </done>
</task>

</tasks>

<verification>
1. `npx vitest run` — all tests pass (existing groq, openrouter, cerebras, generic-openai + new openai tests)
2. `npx tsc --noEmit` — TypeScript compiles without errors
3. Grep confirms no duplicate parseDurationToMs implementations: `grep -r "function parseDurationToMs" src/` should show only `src/providers/utils.ts`
4. Grep confirms groq.ts re-exports: `grep "export.*parseDurationToMs" src/providers/adapters/groq.ts` should match
5. Config example YAML is valid: `node -e "const yaml = require('yaml'); yaml.parse(require('fs').readFileSync('config/config.example.yaml','utf8'));"` or simply verify it loads
</verification>

<success_criteria>
- OpenAI provider type accepted in config schema validation
- OpenAIAdapter created by registry for type 'openai' with correct default baseUrl
- OpenAI rate limit headers parsed identically to Groq (same header names, same duration format)
- parseDurationToMs extracted to src/providers/utils.ts, imported by both groq.ts and openai.ts
- Existing groq tests pass without modification (re-export preserves import path)
- New openai.test.ts covers constructor defaults + full/null/partial header parsing
- config.example.yaml shows OpenAI and Moonshot as chain fallbacks
- USAGE.md and PROVIDERS.md updated with OpenAI and Moonshot references
</success_criteria>
