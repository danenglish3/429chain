---
phase: quick
plan: 001
type: execute
wave: 1
depends_on: []
files_modified:
  - docs/USAGE.md
autonomous: true

must_haves:
  truths:
    - "User can learn how to install and start 429chain in under 60 seconds of reading"
    - "User can find every CLI flag with its short form, type, and default"
    - "User can see every API endpoint with method, path, auth requirement, request body, and response shape"
    - "User can copy-paste a working curl command for each API endpoint"
    - "User can understand the config file format and every setting"
    - "User can learn how to deploy with Docker"
  artifacts:
    - path: "docs/USAGE.md"
      provides: "Complete usage documentation in swagger-style format"
      min_lines: 400
  key_links: []
---

<objective>
Create comprehensive usage documentation for 429chain covering CLI usage, config file format, and full API reference in a clean swagger-style layout.

Purpose: Users need a single reference document to understand how to install, configure, and use 429chain -- both the CLI and the HTTP API.
Output: `docs/USAGE.md` -- a self-contained usage guide.
</objective>

<execution_context>
@C:\Users\danen\.claude/get-shit-done/workflows/execute-plan.md
@C:\Users\danen\.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/cli.ts
@src/index.ts
@src/config/schema.ts
@src/config/types.ts
@src/shared/types.ts
@src/api/routes/chat.ts
@src/api/routes/admin.ts
@src/api/routes/health.ts
@src/api/routes/stats.ts
@src/api/routes/ratelimits.ts
@src/api/routes/models.ts
@src/api/middleware/auth.ts
@config/config.example.yaml
@Dockerfile
@docker-compose.yml
@package.json
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create docs/USAGE.md with full CLI and API reference</name>
  <files>docs/USAGE.md</files>
  <action>
Create `docs/USAGE.md` with the following structure and content. Use swagger-style formatting: clean headers, tables for parameters, fenced code blocks for examples, and consistent endpoint documentation patterns.

**Document structure:**

## 1. Quick Start
- Install: `npm install -g 429chain` or use `npx 429chain`
- Init config: `429chain init`
- Edit config with API keys
- Run: `429chain`
- Node.js >= 20.0.0 required

## 2. CLI Reference
Table format for all flags. Source from `src/cli.ts` parseArgs:

| Flag | Short | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--config <path>` | `-c` | string | `./config/config.yaml` | Path to config file |
| `--port <port>` | `-p` | string | (from config) | Override listen port |
| `--init` | | boolean | | Generate config file |
| `--help` | `-h` | boolean | | Show help |

Include usage examples:
```bash
429chain                                  # Run with default config
429chain --config /etc/429chain.yaml      # Custom config path
429chain --port 8080                      # Override port
429chain --init                           # Create config/config.yaml
npx 429chain                              # Run without global install
```

## 3. Configuration
Document the full YAML config structure derived from `src/config/schema.ts`:

### 3.1 Settings
Table of every setting field from SettingsSchema:
- `port` (number, default: 3429) -- Listen port
- `apiKeys` (string[], required, min 1) -- Bearer tokens for client auth
- `defaultChain` (string, required) -- Chain used when model doesn't match a chain name
- `logLevel` (enum: debug|info|warn|error, default: info)
- `cooldownDefaultMs` (number, default: 60000) -- Cooldown duration after 429
- `requestTimeoutMs` (number, default: 30000) -- Upstream request timeout
- `dbPath` (string, default: ./data/observability.db) -- SQLite database path

### 3.2 Providers
Document ProviderSchema fields:
- `id` (string, required) -- Unique identifier
- `name` (string, required) -- Display name
- `type` (enum: openrouter|groq|cerebras|generic-openai, required) -- Provider adapter
- `apiKey` (string, required) -- Provider API key
- `baseUrl` (url, optional) -- Override default base URL
- `rateLimits` (object, optional) -- Manual rate limit fallback

RateLimits sub-fields: `requestsPerMinute`, `tokensPerMinute`, `requestsPerDay`, `concurrentRequests` (all optional positive integers).

Note that `generic-openai` type requires `baseUrl`.

### 3.3 Chains
Document ChainSchema. A chain is an ordered list of provider+model pairs. On 429, the proxy tries the next entry. Explain that `model` field in API requests is used as chain name lookup first, falling back to defaultChain.

### 3.4 Full Example
Include the full `config.example.yaml` content as a fenced block.

## 4. API Reference
Use swagger-style endpoint documentation. Group by concern. Every endpoint gets:

```
### METHOD /path

Description

**Auth:** Required / None

**Request:**
(body schema as fenced JSON with field descriptions)

**Response:**
(response schema as fenced JSON)

**Example:**
(curl command that works with default config, using localhost:3429)

**Response headers** (if applicable)
```

### 4.1 Proxy Endpoints (OpenAI-compatible)

**POST /v1/chat/completions**
- Auth: Bearer token required
- Request body: OpenAI ChatCompletionRequest format. Document key fields from `ChatCompletionRequest` in `src/shared/types.ts`: model, messages, temperature, max_tokens, top_p, stop, stream, tools, tool_choice, response_format
- Note: `model` field serves dual purpose -- if it matches a chain name, that chain is used; otherwise defaultChain is used and model is passed through
- Response: OpenAI ChatCompletionResponse format
- Response headers: `X-429chain-Provider` (provider/model used), `X-429chain-Attempts` (number of attempts)
- Streaming: When `stream: true`, returns SSE stream of ChatCompletionChunk objects, ending with `data: [DONE]`
- curl examples for both non-streaming and streaming

**GET /v1/models**
- Auth: Bearer token required
- Returns OpenAI-format model list from all chain entries
- Response: `{ object: "list", data: [{ id, object: "model", created, owned_by }] }`

### 4.2 Health

**GET /health**
- Auth: None
- Returns: `{ status, version, uptime, providers, chains }`

### 4.3 Stats

**GET /v1/stats/providers**
- Auth: Bearer token required
- Returns all provider usage stats

**GET /v1/stats/providers/:providerId**
- Auth: Bearer token required
- Returns single provider usage: `{ providerId, totalRequests, totalTokens, totalPromptTokens, totalCompletionTokens, lastRequestTimestamp }`

**GET /v1/stats/chains**
- Auth: Bearer token required
- Returns all chain usage stats

**GET /v1/stats/chains/:chainName**
- Auth: Bearer token required
- Returns single chain usage

**GET /v1/stats/requests**
- Auth: Bearer token required
- Query: `?limit=N` (default 50, max 500)
- Returns recent request logs: `{ requests: [{ id, timestamp, chainName, providerId, model, promptTokens, completionTokens, totalTokens, latencyMs, httpStatus, attempts }] }`

### 4.4 Rate Limits

**GET /v1/ratelimits**
- Auth: Bearer token required
- Returns live rate limit status for all tracked provider+model pairs
- Response shape: `{ ratelimits: [{ provider, model, status, cooldownUntil, reason, quota: { remainingRequests, remainingTokens, resetRequestsMs, resetTokensMs, lastUpdated } | null }] }`

### 4.5 Admin

**GET /v1/admin/config**
- Auth: Bearer token required
- Returns current config with masked API keys

**PUT /v1/admin/providers/:id**
- Auth: Bearer token required
- Body: Full provider object (id, name, type, apiKey, baseUrl?, rateLimits?)
- Creates or updates a provider. ID in path must match body.
- Persists to YAML config file.
- Response: Provider object with masked apiKey

**DELETE /v1/admin/providers/:id**
- Auth: Bearer token required
- Removes provider. Fails if any chains reference it.
- Response: `{ deleted: "provider-id" }`

**PUT /v1/admin/chains/:name**
- Auth: Bearer token required
- Body: `{ entries: [{ provider, model }] }` (min 1 entry)
- Creates or updates a chain. All referenced providers must exist.
- Persists to YAML config file.

**DELETE /v1/admin/chains/:name**
- Auth: Bearer token required
- Removes chain. Cannot delete the default chain.
- Response: `{ deleted: "chain-name" }`

## 5. Authentication
Document that all `/v1/*` routes require `Authorization: Bearer <key>` header where `<key>` matches one of the `settings.apiKeys` values. `/health` is unauthenticated.

Error responses follow OpenAI format:
```json
{
  "error": {
    "message": "...",
    "type": "invalid_request_error",
    "param": null,
    "code": "invalid_api_key"
  }
}
```

## 6. Docker Deployment
- `docker compose up` for quickstart
- Explain bind mount for config, named volume for SQLite data
- Note: WAL mode requires directory mount, not file mount
- Port override via `PORT` env var
- Health checks built in
- Show the docker-compose.yml structure

## 7. Error Handling
- 503 with `AllProvidersExhaustedError` when all chain entries fail/rate-limited
- Standard OpenAI error format for all error responses
- `X-429chain-Provider` and `X-429chain-Attempts` headers on success

## 8. How Waterfall Works
Brief explanation (3-5 paragraphs):
- Request comes in, chain is resolved (by model name or default)
- Proxy tries first entry in chain
- If 429 or rate limited (via headers or manual limits), tries next entry
- Cooldown is applied to the failed provider+model pair
- Rate limit headers from providers are parsed and tracked automatically

**Formatting rules:**
- Use `##` for top-level sections, `###` for subsections
- Use tables for parameter/field listings (swagger style)
- Use fenced code blocks with language hints (bash, json, yaml)
- Every API endpoint gets a working curl example against localhost:3429
- Use `YOUR_API_KEY` as placeholder in curl examples
- Keep descriptions terse and scannable -- no filler prose
- No emojis
  </action>
  <verify>
    - File exists at docs/USAGE.md
    - File has 400+ lines
    - Contains all 8 top-level sections (Quick Start, CLI Reference, Configuration, API Reference, Authentication, Docker Deployment, Error Handling, How Waterfall Works)
    - All 14 API endpoints documented (POST /v1/chat/completions, GET /v1/models, GET /health, GET /v1/stats/providers, GET /v1/stats/providers/:providerId, GET /v1/stats/chains, GET /v1/stats/chains/:chainName, GET /v1/stats/requests, GET /v1/ratelimits, GET /v1/admin/config, PUT /v1/admin/providers/:id, DELETE /v1/admin/providers/:id, PUT /v1/admin/chains/:name, DELETE /v1/admin/chains/:name)
    - Every endpoint has a curl example
    - Config schema fields match src/config/schema.ts
    - No broken markdown (headers, tables, code blocks properly closed)
  </verify>
  <done>
    docs/USAGE.md exists with complete CLI reference, configuration guide, and swagger-style API reference covering all 14 endpoints with curl examples. Every config field, CLI flag, and API response shape is documented.
  </done>
</task>

</tasks>

<verification>
- docs/USAGE.md exists and is well-formed markdown
- All API endpoints from src/api/routes/*.ts are documented
- CLI flags match src/cli.ts parseArgs definition
- Config fields match src/config/schema.ts
- curl examples use correct paths (verified against src/index.ts route mounting)
</verification>

<success_criteria>
- Single docs/USAGE.md file created with 400+ lines
- 8 top-level sections covering CLI, config, API, auth, Docker, errors, and waterfall behavior
- Every API endpoint has method, path, auth requirement, request/response schema, and curl example
- Swagger-style formatting: tables for parameters, fenced code blocks, consistent layout
- No placeholder or TODO sections -- everything is complete
</success_criteria>

<output>
After completion, create `.planning/quick/001-usage-docs-cli-swagger/001-SUMMARY.md`
</output>
