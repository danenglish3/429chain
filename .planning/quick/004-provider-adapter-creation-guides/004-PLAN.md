---
phase: quick
plan: 004
type: execute
wave: 1
depends_on: []
files_modified:
  - docs/PROVIDERS.md
autonomous: true

must_haves:
  truths:
    - "Developer can add a new OpenAI-compatible provider using only config (generic-openai type)"
    - "Developer can create a full custom adapter class for providers with non-standard behavior"
    - "Guide covers all three extension points: parseRateLimitHeaders, prepareRequestBody, getExtraHeaders"
    - "Guide includes the registration steps (registry switch + schema enum)"
    - "Guide includes a test template following existing Vitest patterns"
  artifacts:
    - path: "docs/PROVIDERS.md"
      provides: "Developer-facing provider adapter creation guide"
      min_lines: 200
  key_links:
    - from: "docs/PROVIDERS.md"
      to: "src/providers/base-adapter.ts"
      via: "code examples referencing BaseAdapter"
      pattern: "BaseAdapter"
---

<objective>
Write a developer guide (docs/PROVIDERS.md) explaining how to add new provider adapters to 429chain.

Purpose: Enable contributors to add provider support without needing to reverse-engineer the codebase. Currently there are no developer docs -- only user-facing USAGE.md.

Output: A single markdown file covering both the quick path (generic-openai config) and the full custom adapter path.
</objective>

<execution_context>
@C:\Users\danen\.claude/get-shit-done/workflows/execute-plan.md
@C:\Users\danen\.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/providers/base-adapter.ts
@src/providers/types.ts
@src/providers/registry.ts
@src/config/schema.ts
@src/providers/adapters/generic-openai.ts
@src/providers/adapters/groq.ts
@src/providers/adapters/cerebras.ts
@src/providers/adapters/openrouter.ts
@src/providers/adapters/__tests__/groq.test.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write the provider adapter guide</name>
  <files>docs/PROVIDERS.md</files>
  <action>
Create docs/PROVIDERS.md with the following structure and content. Use real code from the codebase as examples -- do NOT invent fictional patterns. The guide must be practical, concise, and copy-paste-ready.

**Document structure:**

1. **Header / overview** -- One paragraph: 429chain uses a provider adapter system. Two paths to add a provider: quick (generic-openai config) and full (custom adapter class).

2. **Quick Path: generic-openai** -- For any provider that follows the OpenAI API spec:
   - Show a YAML config snippet using `type: generic-openai` with `baseUrl` pointing at the provider
   - Explain that this uses GenericOpenAIAdapter which parses standard `x-ratelimit-*` headers and `retry-after`
   - List what you get for free (chat completions, streaming, basic rate limit parsing) and what you don't get (custom header parsing, parameter stripping, extra headers)
   - Give 2-3 real-world examples: Together AI, Fireworks, any provider with /v1/chat/completions endpoint
   - Note: `baseUrl` is REQUIRED for generic-openai (other types have defaults)

3. **Full Path: Custom Adapter** -- Step-by-step walkthrough to create a custom adapter. Use a realistic hypothetical "Acme AI" provider as the running example throughout. Walk through these sub-steps:

   a. **Create the adapter file** (`src/providers/adapters/acme.ts`):
      - Import BaseAdapter and RateLimitInfo
      - Extend BaseAdapter
      - Constructor: call super with provider type string, optional default base URL
      - Show the full file skeleton with all three override points annotated

   b. **Implement parseRateLimitHeaders()** (REQUIRED override):
      - Explain this is the only abstract method -- must be implemented
      - Show the RateLimitInfo interface fields and what each one means
      - Show example parsing referencing how Groq parses duration strings vs how OpenRouter parses ms-timestamps vs how Cerebras parses day/minute headers -- demonstrate that every provider is different
      - Pattern: read headers with `headers.get()`, return null if no recognized headers, build RateLimitInfo object

   c. **Override prepareRequestBody()** (OPTIONAL):
      - When to use: provider rejects certain OpenAI parameters
      - Show Cerebras example: stripping `presence_penalty` and `frequency_penalty`
      - Template: call super or manually destructure, delete unsupported keys, return

   d. **Override getExtraHeaders()** (OPTIONAL):
      - When to use: provider requires additional headers beyond Authorization
      - Show OpenRouter example: `HTTP-Referer` and `X-Title`
      - Template: return record of header name to value

   e. **Register the adapter** -- Two files to touch:
      - `src/providers/registry.ts`: Import the adapter, add a case to the `createAdapter` switch statement. Show exact code.
      - `src/config/schema.ts`: Add the type string to the `z.enum()` array in ProviderSchema. Show exact code.

   f. **Write tests** (`src/providers/adapters/__tests__/acme.test.ts`):
      - Follow existing pattern from groq.test.ts
      - Show test template covering: constructor defaults, parseRateLimitHeaders with all headers, with no headers (returns null), with partial headers
      - If prepareRequestBody is overridden, test parameter stripping

4. **Architecture reference** -- Brief section:
   - Explain the BaseAdapter handles all HTTP logic (chatCompletion, chatCompletionStream) so adapters never deal with fetch
   - Explain the waterfall: on 429, ProviderRateLimitError is thrown, chain router catches it, tries next provider
   - Diagram or list showing: Config YAML -> buildRegistry() -> createAdapter() switch -> Adapter instance -> chain router uses it

5. **Checklist** -- A copy-paste checklist at the bottom:
   - [ ] Adapter file created extending BaseAdapter
   - [ ] parseRateLimitHeaders() implemented
   - [ ] prepareRequestBody() overridden (if needed)
   - [ ] getExtraHeaders() overridden (if needed)
   - [ ] Registered in registry.ts switch
   - [ ] Type added to schema.ts enum
   - [ ] Tests written and passing
   - [ ] Config YAML updated with new provider

**Style guidelines:**
- Use fenced code blocks with `typescript` or `yaml` language tags
- Keep code examples complete and copy-pasteable, not snippets with `...` gaps
- Reference actual file paths relative to project root
- No emojis
- Concise prose -- developers read code, not paragraphs
- Total length: 250-400 lines of markdown
  </action>
  <verify>
    - File exists at docs/PROVIDERS.md
    - Contains both "generic-openai" quick path and custom adapter path
    - All code examples use correct imports (BaseAdapter from '../base-adapter.js', RateLimitInfo from '../types.js')
    - References to real files match actual paths (src/providers/adapters/, src/providers/registry.ts, src/config/schema.ts)
    - Checklist section present at bottom
  </verify>
  <done>
    docs/PROVIDERS.md exists with practical, code-rich guide covering both the generic-openai quick path and the full custom adapter creation path, including registration steps, test template, and developer checklist.
  </done>
</task>

</tasks>

<verification>
- docs/PROVIDERS.md exists and is 200+ lines
- Code examples reference correct file paths and import paths
- Both quick path (generic-openai config) and full path (custom adapter) are covered
- Registration steps (registry.ts + schema.ts) are documented with exact code
- Test template follows existing Vitest patterns from the codebase
</verification>

<success_criteria>
A developer unfamiliar with the codebase can read docs/PROVIDERS.md and successfully add a new provider adapter (either via config or custom class) without needing to study the source code first.
</success_criteria>

<output>
After completion, create `.planning/quick/004-provider-adapter-creation-guides/004-SUMMARY.md`
</output>
