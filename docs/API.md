# 429chain API Reference

Quick reference for all API endpoints. For full usage documentation including configuration, Docker deployment, and concepts, see [USAGE.md](./USAGE.md).

**Base URL:** `http://localhost:3429` (default port)

**Authentication:** All `/v1/*` routes require `Authorization: Bearer <your-api-key>`. The `/health` endpoint is public.

---

## Endpoints

### POST /v1/chat/completions

Create a chat completion. Drop-in replacement for OpenAI's chat completions endpoint.

**Auth:** Required

**Request:**

```json
{
  "model": "default",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello!" }
  ],
  "temperature": 0.7,
  "max_tokens": 1000,
  "stream": false
}
```

The `model` field selects a chain: if it matches a chain name, that chain is used; otherwise `defaultChain` is used and the value is passed through to the provider.

**Response (non-streaming):**

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "llama-3.1-8b-instant",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Hello! How can I help?" },
      "finish_reason": "stop"
    }
  ],
  "usage": { "prompt_tokens": 20, "completion_tokens": 10, "total_tokens": 30 }
}
```

**Response headers:**

- `X-429chain-Provider`: Provider and model used (e.g., `groq/llama-3.1-8b-instant`)
- `X-429chain-Attempts`: Number of providers tried before success

**Streaming:** Set `"stream": true` to receive SSE chunks in OpenAI format. The proxy injects `stream_options.include_usage` so the final chunk includes token counts.

---

### GET /v1/models

List all models from configured chains.

**Auth:** Required

**Response:**

```json
{
  "object": "list",
  "data": [
    { "id": "meta-llama/llama-3.1-8b-instruct:free", "object": "model", "created": 1234567890, "owned_by": "openrouter" },
    { "id": "llama-3.1-8b-instant", "object": "model", "created": 1234567890, "owned_by": "groq" }
  ]
}
```

---

### GET /health

Health check. No authentication required.

**Response:**

```json
{ "status": "ok", "version": "0.1.0", "uptime": 12345.67, "providers": 3, "chains": 2 }
```

---

### GET /v1/ratelimits

Live rate limit status for all tracked provider+model pairs. Includes queue depth when queue mode is enabled.

**Auth:** Required

**Response (queue mode disabled):**

```json
{
  "ratelimits": [
    {
      "provider": "groq",
      "model": "llama-3.1-8b-instant",
      "status": "tracking",
      "cooldownUntil": null,
      "reason": null,
      "quota": {
        "remainingRequests": 25,
        "remainingTokens": 12000,
        "resetRequestsMs": 45000,
        "resetTokensMs": 45000,
        "lastUpdated": 1234567890000
      }
    },
    {
      "provider": "openrouter",
      "model": "meta-llama/llama-3.1-8b-instruct:free",
      "status": "exhausted",
      "cooldownUntil": 1234567950000,
      "reason": "Rate limit exceeded",
      "quota": {
        "remainingRequests": 0,
        "remainingTokens": 0,
        "resetRequestsMs": 60000,
        "resetTokensMs": 60000,
        "lastUpdated": 1234567890000
      }
    }
  ]
}
```

**Response (queue mode enabled):** Includes a `queue` field with per-chain queue statistics:

```json
{
  "ratelimits": [ ... ],
  "queue": [
    {
      "chainName": "default",
      "depth": 3,
      "oldestItemAgeMs": 12500
    }
  ]
}
```

**Queue fields:**

| Field | Type | Description |
|-------|------|-------------|
| `chainName` | string | Chain name with queued requests |
| `depth` | number | Number of requests currently waiting |
| `oldestItemAgeMs` | number | Age of the oldest queued request in milliseconds |

Only chains with at least one queued request appear in the `queue` array. When no requests are queued, the array is empty (or the field is omitted).

**Status values:**

| Value | Description |
|-------|-------------|
| `available` | Not yet tracked or at full quota |
| `tracking` | Quota data received, capacity remaining |
| `exhausted` | Rate limited — in cooldown until `cooldownUntil` |

---

### GET /v1/stats/providers

Usage statistics for all providers.

**Auth:** Required

**Response:**

```json
{
  "providers": [
    {
      "providerId": "groq",
      "totalRequests": 150,
      "totalTokens": 45000,
      "totalPromptTokens": 30000,
      "totalCompletionTokens": 15000,
      "lastRequestTimestamp": 1234567890000
    }
  ]
}
```

---

### GET /v1/stats/providers/:providerId

Usage statistics for a single provider. Returns 404 if no data exists for the provider.

**Auth:** Required

---

### GET /v1/stats/chains

Usage statistics for all chains.

**Auth:** Required

**Response:**

```json
{
  "chains": [
    {
      "chainName": "default",
      "totalRequests": 200,
      "totalTokens": 60000,
      "totalPromptTokens": 40000,
      "totalCompletionTokens": 20000,
      "lastRequestTimestamp": 1234567890000
    }
  ]
}
```

---

### GET /v1/stats/chains/:chainName

Usage statistics for a single chain. Returns 404 if no data exists for the chain.

**Auth:** Required

---

### GET /v1/stats/requests

Recent request logs.

**Auth:** Required

**Query parameters:**

- `limit` (optional): Number of requests to return. Default: 50. Max: 500.

**Response:**

```json
{
  "requests": [
    {
      "id": 1,
      "timestamp": 1234567890000,
      "chainName": "default",
      "providerId": "groq",
      "model": "llama-3.1-8b-instant",
      "promptTokens": 100,
      "completionTokens": 50,
      "totalTokens": 150,
      "latencyMs": 1234,
      "httpStatus": 200,
      "attempts": 1
    }
  ]
}
```

---

### GET /v1/admin/config

Current configuration with API keys masked as `***`.

**Auth:** Required

**Response:**

```json
{
  "providers": [{ "id": "groq", "name": "Groq", "type": "groq", "apiKey": "***" }],
  "chains": [{ "name": "default", "entries": [{ "provider": "groq", "model": "llama-3.1-8b-instant" }] }]
}
```

---

### PUT /v1/admin/providers/:id

Create or update a provider. Persists to the YAML config file.

**Auth:** Required

**Request body:**

```json
{
  "id": "my-provider",
  "name": "My Provider",
  "type": "generic-openai",
  "apiKey": "sk-your-key",
  "baseUrl": "https://api.example.com/v1"
}
```

**Response:** Provider object with masked API key.

---

### DELETE /v1/admin/providers/:id

Delete a provider. Fails if any chains reference the provider.

**Auth:** Required

**Response:** `{ "deleted": "provider-id" }`

**Error (400):** `{ "error": "Provider is referenced by chains: default, fast" }`

---

### PUT /v1/admin/chains/:name

Create or update a chain. All referenced providers must exist. Persists to the YAML config file.

**Auth:** Required

**Request body:**

```json
{
  "entries": [
    { "provider": "groq", "model": "llama-3.1-8b-instant" },
    { "provider": "cerebras", "model": "llama-3.1-8b" }
  ]
}
```

**Response:** Chain object.

---

### DELETE /v1/admin/chains/:name

Delete a chain. Cannot delete the default chain.

**Auth:** Required

**Response:** `{ "deleted": "chain-name" }`

---

### POST /v1/test/chain/:name

Test each entry in a chain individually (no waterfall). Returns results for every provider+model pair.

**Auth:** Required

**Request body (optional):**

```json
{ "prompt": "Say hello in one word." }
```

**Response:**

```json
{
  "chain": "default",
  "results": [
    {
      "provider": "groq",
      "model": "llama-3.1-8b-instant",
      "status": "ok",
      "latencyMs": 1234,
      "response": "Hello!",
      "tokens": { "prompt": 12, "completion": 3, "total": 15 }
    },
    {
      "provider": "openrouter",
      "model": "meta-llama/llama-3.1-8b-instruct:free",
      "status": "error",
      "latencyMs": 500,
      "error": "429: rate limited"
    }
  ],
  "summary": { "total": 2, "ok": 1, "failed": 1 }
}
```

---

## Queue Mode

Queue mode holds requests when all providers in a chain are exhausted, instead of immediately returning a 503. Requests wait in a FIFO queue and are retried automatically when a provider comes off cooldown.

### Configuration

Enable queue mode in `config/config.yaml` under `settings`:

```yaml
settings:
  queueMode: true          # Enable queue mode (default: false)
  queueMaxWaitMs: 300000   # Max wait time per request in ms (default: 300000 = 5 minutes)
  queueMaxSize: 100        # Max queued requests per chain (default: 100)
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `queueMode` | boolean | `false` | Enable or disable queue mode |
| `queueMaxWaitMs` | number (ms) | `300000` | Maximum time a request waits before returning a 503 timeout error |
| `queueMaxSize` | number | `100` | Maximum number of requests queued per chain — new requests beyond this limit immediately return 503 |

### Behavior

When `queueMode: true`:

1. A request arrives and all providers in the chain are exhausted (in cooldown)
2. Instead of returning 503, the request is held in an in-memory FIFO queue for that chain
3. When any provider in the chain comes off cooldown, the queue drains one item at a time
4. The request retries the full chain waterfall — if the newly-available provider succeeds, the response is returned to the client
5. If the retry still exhausts all providers (re-429d immediately), the item stays queued until the next provider becomes available

Both streaming and non-streaming requests queue the same way. The client connection stays open while the request waits.

**Important:** The queue is in-memory and does not survive process restarts. On graceful shutdown (SIGTERM/SIGINT), all queued requests are rejected immediately so clients receive a clean error rather than a hanging connection.

### Queue Errors

When a request cannot be served from the queue, the proxy returns a 503 with a distinct error code:

**Queue timeout** — request waited longer than `queueMaxWaitMs`:

```json
{
  "error": {
    "message": "Request timed out waiting in queue for chain 'default' after 300000ms",
    "type": "service_unavailable",
    "param": null,
    "code": "queue_timeout"
  }
}
```

**Queue full** — chain queue has reached `queueMaxSize`:

```json
{
  "error": {
    "message": "Queue for chain 'default' is full (100 items)",
    "type": "service_unavailable",
    "param": null,
    "code": "queue_full"
  }
}
```

### Monitoring Queue Depth

Queue depth is visible in the `/v1/ratelimits` response when queue mode is enabled. The `queue` array shows how many requests are waiting per chain:

```bash
curl http://localhost:3429/v1/ratelimits \
  -H "Authorization: Bearer YOUR_API_KEY"
```

```json
{
  "ratelimits": [ ... ],
  "queue": [
    { "chainName": "default", "depth": 3, "oldestItemAgeMs": 12500 }
  ]
}
```

Use this to tune `queueMaxWaitMs` and `queueMaxSize` for your workload.

---

## Error Reference

All errors use OpenAI-compatible format:

```json
{
  "error": {
    "message": "Error description",
    "type": "error_type",
    "param": null,
    "code": "error_code"
  }
}
```

| Status | Code | Description |
|--------|------|-------------|
| 401 | `invalid_api_key` | Missing or invalid Bearer token |
| 400 | `invalid_request` | Malformed request body |
| 402 | `payment_required` | Provider requires payment (5-minute cooldown applied, waterfall continues) |
| 503 | `all_providers_exhausted` | All chain entries exhausted and queue mode is disabled |
| 503 | `queue_timeout` | Request exceeded `queueMaxWaitMs` while waiting in queue |
| 503 | `queue_full` | Chain queue has reached `queueMaxSize` |
| 500 | `internal_error` | Internal proxy error |
