# 429chain Usage Guide

Complete reference for installing, configuring, and using 429chain — an OpenAI-compatible proxy that waterfalls requests through provider chains on rate limits.

## 1. Quick Start

### Installation

Install globally via npm:

```bash
npm install -g 429chain
```

Or use without installation via npx:

```bash
npx 429chain
```

**Requirements:** Node.js >= 20.0.0

### Initialize Configuration

Generate a config file in the current directory:

```bash
429chain --init
```

This creates `config/config.yaml` from the example template.

### Configure API Keys

Edit `config/config.yaml` and replace placeholder API keys with your actual provider keys:

```yaml
settings:
  apiKeys:
    - "your-proxy-api-key-here"  # Change this to a secure key

providers:
  - id: openrouter
    apiKey: "sk-or-v1-your-key-here"  # Add your OpenRouter key

  - id: groq
    apiKey: "gsk_your-key-here"  # Add your Groq key

  - id: cerebras
    apiKey: "csk-your-key-here"  # Add your Cerebras key
```

### Start the Proxy

```bash
429chain
```

The proxy starts on port 3429 by default. Check health:

```bash
curl http://localhost:3429/health
```

You're ready to make requests.

---

## 2. CLI Reference

### Command Syntax

```bash
429chain [options]
```

### Options

| Flag | Short | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--config <path>` | `-c` | string | `./config/config.yaml` | Path to config file |
| `--port <port>` | `-p` | string | (from config) | Override listen port |
| `--init` | | boolean | | Generate config file |
| `--help` | `-h` | boolean | | Show help message |

### Usage Examples

Run with default config:

```bash
429chain
```

Use custom config path:

```bash
429chain --config /etc/429chain.yaml
```

Override port:

```bash
429chain --port 8080
```

Initialize config file:

```bash
429chain --init
```

Run via npx without global install:

```bash
npx 429chain
```

---

## 3. Configuration

The config file uses YAML format. All settings are defined via Zod schemas for validation.

### 3.1 Settings

Top-level proxy settings.

| Field | Type | Default | Required | Description |
|-------|------|---------|----------|-------------|
| `port` | number | 3429 | No | HTTP listen port (1-65535) |
| `apiKeys` | string[] | | Yes | Bearer tokens for client authentication (min 1) |
| `defaultChain` | string | | Yes | Chain name used when model field doesn't match a chain |
| `logLevel` | enum | info | No | Log level: `debug`, `info`, `warn`, `error` |
| `cooldownDefaultMs` | number | 60000 | No | Cooldown duration after 429 (milliseconds, min 1000) |
| `requestTimeoutMs` | number | 30000 | No | Upstream request timeout (milliseconds, min 1000) |
| `dbPath` | string | ./data/observability.db | No | SQLite database path for request logging |

**Example:**

```yaml
settings:
  port: 3429
  apiKeys:
    - "your-secure-api-key"
  defaultChain: "default"
  logLevel: info
  cooldownDefaultMs: 60000
  requestTimeoutMs: 30000
  dbPath: ./data/observability.db
```

### 3.2 Providers

Provider definitions. Each provider represents an upstream LLM API.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique provider identifier |
| `name` | string | Yes | Display name |
| `type` | enum | Yes | Provider adapter: `openrouter`, `groq`, `cerebras`, `generic-openai` |
| `apiKey` | string | Yes | Provider API key |
| `baseUrl` | url | No | Override default base URL (required for `generic-openai` type) |
| `rateLimits` | object | No | Manual rate limit fallback (see below) |

**Provider Types:**

- `openrouter` - OpenRouter API (default baseUrl: https://openrouter.ai/api/v1)
- `groq` - Groq API (default baseUrl: https://api.groq.com/openai/v1)
- `cerebras` - Cerebras API (default baseUrl: https://api.cerebras.ai/v1)
- `generic-openai` - Generic OpenAI-compatible API (requires `baseUrl`)

**Rate Limits (optional):**

Manual rate limit fallback used when provider doesn't return rate limit headers.

| Field | Type | Description |
|-------|------|-------------|
| `requestsPerMinute` | number | Max requests per minute (positive integer) |
| `tokensPerMinute` | number | Max tokens per minute (positive integer) |
| `requestsPerDay` | number | Max requests per day (positive integer) |
| `concurrentRequests` | number | Max concurrent requests (positive integer) |

All rate limit fields are optional. Header-based tracking takes precedence when available.

**Example:**

```yaml
providers:
  - id: openrouter
    name: OpenRouter
    type: openrouter
    apiKey: "sk-or-v1-your-key-here"
    # baseUrl defaults to https://openrouter.ai/api/v1

  - id: groq
    name: Groq
    type: groq
    apiKey: "gsk_your-key-here"
    rateLimits:
      requestsPerMinute: 30
      tokensPerMinute: 15000

  - id: custom-api
    name: Custom OpenAI API
    type: generic-openai
    apiKey: "custom-key"
    baseUrl: "https://api.example.com/v1"
```

### 3.3 Chains

A chain is an ordered list of provider+model pairs. When a request encounters a rate limit, the proxy tries the next entry.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Chain name (min 1 character) |
| `entries` | array | Yes | Provider+model pairs (min 1 entry) |

**Chain Entry Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | string | Yes | Provider ID (must exist in providers list) |
| `model` | string | Yes | Model identifier for the provider |

**How Chain Selection Works:**

1. Client sends a request with `model` field
2. If `model` matches a chain name, that chain is used
3. Otherwise, `defaultChain` is used
4. The `model` field is passed through to the provider

**Example:**

```yaml
chains:
  - name: default
    entries:
      - provider: openrouter
        model: "meta-llama/llama-3.1-8b-instruct:free"
      - provider: groq
        model: "llama-3.1-8b-instant"
      - provider: cerebras
        model: "llama-3.1-8b"

  - name: fast
    entries:
      - provider: groq
        model: "llama-3.1-8b-instant"
      - provider: cerebras
        model: "llama-3.1-8b"
```

**Usage:**

```bash
# Uses "default" chain (matches chain name)
curl -X POST http://localhost:3429/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"model": "default", "messages": [...]}'

# Uses "fast" chain (matches chain name)
curl -X POST http://localhost:3429/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"model": "fast", "messages": [...]}'

# Uses defaultChain (no match, falls back)
curl -X POST http://localhost:3429/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"model": "gpt-4", "messages": [...]}'
```

### 3.4 Full Example Configuration

```yaml
# 429chain configuration
version: 1

settings:
  port: 3429
  apiKeys:
    - "your-proxy-api-key-here"  # API key(s) that clients use to access this proxy
  defaultChain: "default"
  logLevel: info
  cooldownDefaultMs: 60000       # Default cooldown on 429 (ms)
  requestTimeoutMs: 30000        # Upstream request timeout (ms)

providers:
  - id: openrouter
    name: OpenRouter
    type: openrouter
    apiKey: "sk-or-v1-your-key-here"
    # baseUrl defaults to https://openrouter.ai/api/v1

  - id: groq
    name: Groq
    type: groq
    apiKey: "gsk_your-key-here"
    # baseUrl defaults to https://api.groq.com/openai/v1
    # Optional: manual rate limits as fallback when provider headers unavailable
    rateLimits:
      requestsPerMinute: 30    # Groq free tier: 30 RPM
      tokensPerMinute: 15000   # Groq free tier: ~15k TPM
      # requestsPerDay: 14400  # Optional daily limit
      # concurrentRequests: 1  # Optional concurrent limit (enforcement deferred)

  - id: cerebras
    name: Cerebras
    type: cerebras
    apiKey: "csk-your-key-here"
    # baseUrl defaults to https://api.cerebras.ai/v1

chains:
  - name: default
    entries:
      - provider: openrouter
        model: "meta-llama/llama-3.1-8b-instruct:free"
      - provider: groq
        model: "llama-3.1-8b-instant"
      - provider: cerebras
        model: "llama-3.1-8b"

  - name: fast
    entries:
      - provider: groq
        model: "llama-3.1-8b-instant"
      - provider: cerebras
        model: "llama-3.1-8b"
```

---

## 4. API Reference

All endpoints follow OpenAI-compatible patterns. The proxy is a drop-in replacement for OpenAI's API.

### 4.1 Proxy Endpoints (OpenAI-compatible)

#### POST /v1/chat/completions

Create a chat completion. Supports both streaming and non-streaming modes.

**Auth:** Required (Bearer token)

**Request Body:**

```json
{
  "model": "default",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": "Hello!"
    }
  ],
  "temperature": 0.7,
  "max_tokens": 1000,
  "top_p": 1.0,
  "stop": null,
  "stream": false,
  "tools": [],
  "tool_choice": "auto",
  "response_format": { "type": "text" },
  "n": 1,
  "presence_penalty": 0.0,
  "frequency_penalty": 0.0,
  "user": "user-123"
}
```

**Request Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `model` | string | Yes | Model name or chain name (used for chain selection) |
| `messages` | array | Yes | Array of chat messages with `role` and `content` |
| `temperature` | number | No | Sampling temperature (0-2) |
| `max_tokens` | number | No | Maximum tokens to generate |
| `top_p` | number | No | Nucleus sampling parameter |
| `stop` | string/array | No | Stop sequences |
| `stream` | boolean | No | Enable SSE streaming (default: false) |
| `tools` | array | No | Function calling tools |
| `tool_choice` | string/object | No | Tool selection: `none`, `auto`, `required`, or specific function |
| `response_format` | object | No | Response format: `{ type: "text" \| "json_object" }` |
| `n` | number | No | Number of completions to generate |
| `presence_penalty` | number | No | Presence penalty (-2.0 to 2.0) |
| `frequency_penalty` | number | No | Frequency penalty (-2.0 to 2.0) |
| `user` | string | No | User identifier for tracking |

**Note on `model` field:** The `model` field serves a dual purpose:

1. **Chain selection:** If `model` matches a chain name, that chain is used
2. **Provider model:** If no chain match, `defaultChain` is used and `model` is passed to the provider

**Response (Non-streaming):**

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "llama-3.1-8b-instant",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 10,
    "total_tokens": 30
  }
}
```

**Response Headers:**

- `X-429chain-Provider`: Provider and model used (format: `provider-id/model`)
- `X-429chain-Attempts`: Number of attempts before success

**Streaming Mode:**

When `stream: true`, the response is an SSE stream of `ChatCompletionChunk` objects:

```
data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1234567890,"model":"llama-3.1-8b-instant","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1234567890,"model":"llama-3.1-8b-instant","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1234567890,"model":"llama-3.1-8b-instant","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":20,"completion_tokens":10,"total_tokens":30}}

data: [DONE]
```

The final chunk includes `usage` data when `stream_options.include_usage` is set (automatically injected by the proxy).

**Example (Non-streaming):**

```bash
curl -X POST http://localhost:3429/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "default",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "What is the capital of France?"}
    ],
    "temperature": 0.7,
    "max_tokens": 100
  }'
```

**Example (Streaming):**

```bash
curl -X POST http://localhost:3429/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -N \
  -d '{
    "model": "fast",
    "messages": [
      {"role": "user", "content": "Count to 5"}
    ],
    "stream": true
  }'
```

---

#### GET /v1/models

List all available models from configured chains.

**Auth:** Required (Bearer token)

**Response:**

```json
{
  "object": "list",
  "data": [
    {
      "id": "meta-llama/llama-3.1-8b-instruct:free",
      "object": "model",
      "created": 1234567890,
      "owned_by": "openrouter"
    },
    {
      "id": "llama-3.1-8b-instant",
      "object": "model",
      "created": 1234567890,
      "owned_by": "groq"
    }
  ]
}
```

Each model entry includes:

- `id`: Model identifier
- `object`: Always "model"
- `created`: Unix timestamp
- `owned_by`: Provider ID

**Example:**

```bash
curl http://localhost:3429/v1/models \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

### 4.2 Health

#### GET /health

Check proxy health and status.

**Auth:** None (public endpoint)

**Response:**

```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime": 12345.67,
  "providers": 3,
  "chains": 2
}
```

**Fields:**

- `status`: Always "ok" if responding
- `version`: Package version
- `uptime`: Process uptime in seconds
- `providers`: Number of configured providers
- `chains`: Number of configured chains

**Example:**

```bash
curl http://localhost:3429/health
```

---

### 4.3 Stats

Usage statistics from the observability database.

#### GET /v1/stats/providers

Get usage stats for all providers.

**Auth:** Required (Bearer token)

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

**Example:**

```bash
curl http://localhost:3429/v1/stats/providers \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

#### GET /v1/stats/providers/:providerId

Get usage stats for a single provider.

**Auth:** Required (Bearer token)

**Parameters:**

- `providerId` (path): Provider identifier

**Response:**

```json
{
  "providerId": "groq",
  "totalRequests": 150,
  "totalTokens": 45000,
  "totalPromptTokens": 30000,
  "totalCompletionTokens": 15000,
  "lastRequestTimestamp": 1234567890000
}
```

**Error Response (404):**

```json
{
  "error": "No usage data for provider"
}
```

**Example:**

```bash
curl http://localhost:3429/v1/stats/providers/groq \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

#### GET /v1/stats/chains

Get usage stats for all chains.

**Auth:** Required (Bearer token)

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

**Example:**

```bash
curl http://localhost:3429/v1/stats/chains \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

#### GET /v1/stats/chains/:chainName

Get usage stats for a single chain.

**Auth:** Required (Bearer token)

**Parameters:**

- `chainName` (path): Chain name

**Response:**

```json
{
  "chainName": "default",
  "totalRequests": 200,
  "totalTokens": 60000,
  "totalPromptTokens": 40000,
  "totalCompletionTokens": 20000,
  "lastRequestTimestamp": 1234567890000
}
```

**Error Response (404):**

```json
{
  "error": "No usage data for chain"
}
```

**Example:**

```bash
curl http://localhost:3429/v1/stats/chains/default \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

#### GET /v1/stats/requests

Get recent request logs.

**Auth:** Required (Bearer token)

**Query Parameters:**

- `limit` (optional): Number of requests to return (default: 50, max: 500)

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

**Example:**

```bash
# Get last 10 requests
curl http://localhost:3429/v1/stats/requests?limit=10 \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

### 4.4 Rate Limits

Live rate limit status for all tracked provider+model pairs.

#### GET /v1/ratelimits

Get rate limit status for all provider+model pairs.

**Auth:** Required (Bearer token)

**Response:**

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

**Status Values:**

- `available`: Provider has not been tracked yet or has full quota
- `tracking`: Provider is being tracked with quota information
- `exhausted`: Provider is rate limited (in cooldown)

**Example:**

```bash
curl http://localhost:3429/v1/ratelimits \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

### 4.5 Admin

Runtime configuration management. All mutations persist to the YAML config file.

#### GET /v1/admin/config

Get current configuration with masked API keys.

**Auth:** Required (Bearer token)

**Response:**

```json
{
  "providers": [
    {
      "id": "groq",
      "name": "Groq",
      "type": "groq",
      "apiKey": "***",
      "rateLimits": {
        "requestsPerMinute": 30,
        "tokensPerMinute": 15000
      }
    }
  ],
  "chains": [
    {
      "name": "default",
      "entries": [
        {
          "provider": "groq",
          "model": "llama-3.1-8b-instant"
        }
      ]
    }
  ]
}
```

**Example:**

```bash
curl http://localhost:3429/v1/admin/config \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

#### PUT /v1/admin/providers/:id

Create or update a provider. Changes are persisted to the YAML config file.

**Auth:** Required (Bearer token)

**Parameters:**

- `id` (path): Provider identifier (must match body `id`)

**Request Body:**

```json
{
  "id": "new-provider",
  "name": "New Provider",
  "type": "generic-openai",
  "apiKey": "sk-your-key",
  "baseUrl": "https://api.example.com/v1",
  "rateLimits": {
    "requestsPerMinute": 60,
    "tokensPerMinute": 30000
  }
}
```

**Response:**

```json
{
  "provider": {
    "id": "new-provider",
    "name": "New Provider",
    "type": "generic-openai",
    "apiKey": "***",
    "baseUrl": "https://api.example.com/v1",
    "rateLimits": {
      "requestsPerMinute": 60,
      "tokensPerMinute": 30000
    }
  }
}
```

**Error Response (400):**

```json
{
  "error": "Provider ID in path must match ID in body"
}
```

**Validation Errors:**

```json
{
  "error": "Validation error at providers[0].type: Invalid enum value..."
}
```

**Example:**

```bash
curl -X PUT http://localhost:3429/v1/admin/providers/new-provider \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "new-provider",
    "name": "New Provider",
    "type": "generic-openai",
    "apiKey": "sk-your-key",
    "baseUrl": "https://api.example.com/v1"
  }'
```

---

#### DELETE /v1/admin/providers/:id

Delete a provider. Fails if any chains reference the provider.

**Auth:** Required (Bearer token)

**Parameters:**

- `id` (path): Provider identifier

**Response:**

```json
{
  "deleted": "provider-id"
}
```

**Error Response (400):**

```json
{
  "error": "Provider is referenced by chains: default, fast"
}
```

**Error Response (404):**

```json
{
  "error": "Provider not found"
}
```

**Example:**

```bash
curl -X DELETE http://localhost:3429/v1/admin/providers/old-provider \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

#### PUT /v1/admin/chains/:name

Create or update a chain. All referenced providers must exist.

**Auth:** Required (Bearer token)

**Parameters:**

- `name` (path): Chain name

**Request Body:**

```json
{
  "entries": [
    {
      "provider": "groq",
      "model": "llama-3.1-8b-instant"
    },
    {
      "provider": "cerebras",
      "model": "llama-3.1-8b"
    }
  ]
}
```

**Response:**

```json
{
  "chain": {
    "name": "new-chain",
    "entries": [
      {
        "provider": "groq",
        "model": "llama-3.1-8b-instant"
      },
      {
        "provider": "cerebras",
        "model": "llama-3.1-8b"
      }
    ]
  }
}
```

**Error Response (400):**

```json
{
  "error": "Chain references non-existent providers: unknown-provider"
}
```

**Example:**

```bash
curl -X PUT http://localhost:3429/v1/admin/chains/new-chain \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "entries": [
      {"provider": "groq", "model": "llama-3.1-8b-instant"},
      {"provider": "cerebras", "model": "llama-3.1-8b"}
    ]
  }'
```

---

#### DELETE /v1/admin/chains/:name

Delete a chain. Cannot delete the default chain.

**Auth:** Required (Bearer token)

**Parameters:**

- `name` (path): Chain name

**Response:**

```json
{
  "deleted": "chain-name"
}
```

**Error Response (400):**

```json
{
  "error": "Cannot delete default chain"
}
```

**Error Response (404):**

```json
{
  "error": "Chain not found"
}
```

**Example:**

```bash
curl -X DELETE http://localhost:3429/v1/admin/chains/old-chain \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## 5. Authentication

All `/v1/*` routes require Bearer token authentication. The `/health` endpoint is public.

### Authentication Method

Include an `Authorization` header with a Bearer token that matches one of the `settings.apiKeys` values in your config:

```bash
curl http://localhost:3429/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{...}'
```

### Error Response

When authentication fails, the proxy returns an OpenAI-compatible error:

**Status:** 401 Unauthorized

**Body:**

```json
{
  "error": {
    "message": "Invalid or missing API key",
    "type": "invalid_request_error",
    "param": null,
    "code": "invalid_api_key"
  }
}
```

---

## 6. Docker Deployment

Run 429chain in Docker for production deployments.

### Quick Start with Docker Compose

The project includes a `docker-compose.yml` for single-command deployment:

```bash
docker compose up
```

This builds the image and starts the proxy with:

- Config bind mount at `./config/config.yaml`
- Named volume for SQLite data persistence
- Health checks enabled
- Auto-restart on failure

### Docker Compose Configuration

```yaml
services:
  proxy:
    build:
      context: .
      dockerfile: Dockerfile
    image: 429chain:latest
    container_name: 429chain-proxy
    init: true  # Enable tini for graceful shutdown
    ports:
      - "${PORT:-3429}:3429"
    volumes:
      # Named volume for SQLite database persistence
      # IMPORTANT: WAL mode requires directory mount, not file mount
      - data:/app/data

      # Bind mount for user configuration
      # Writable (no :ro) to support admin API config writes
      - ./config/config.yaml:/app/config/config.yaml
    environment:
      - NODE_ENV=production
      - CONFIG_PATH=/app/config/config.yaml
    env_file:
      - path: ./.env
        required: false
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3429/health"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 10s
    restart: unless-stopped

volumes:
  data:
    driver: local
```

### Environment Variables

Override settings via environment variables:

- `PORT`: Override listen port (default: 3429)
- `CONFIG_PATH`: Override config file path
- `NODE_ENV`: Set to `production` for production mode

Create an optional `.env` file:

```bash
PORT=8080
```

### SQLite Data Persistence

The database uses SQLite in WAL (Write-Ahead Logging) mode, which creates three files:

- `observability.db` - Main database
- `observability.db-wal` - Write-ahead log
- `observability.db-shm` - Shared memory

**Important:** WAL mode requires mounting the entire `/app/data` directory, not individual files. The Docker Compose config uses a named volume for this:

```yaml
volumes:
  - data:/app/data
```

### Config File Updates

The config file is bind-mounted as writable (no `:ro` flag) because the admin API (`PUT /v1/admin/providers`, `PUT /v1/admin/chains`) persists changes back to the YAML file.

If you don't use the admin API, you can make it read-only:

```yaml
volumes:
  - ./config/config.yaml:/app/config/config.yaml:ro
```

### Health Checks

The health check uses the `/health` endpoint:

```bash
curl -f http://localhost:3429/health
```

Check container health status:

```bash
docker ps
# Look for "healthy" in STATUS column
```

### Backup Database

Backup the SQLite database from the named volume:

```bash
docker run --rm \
  --volumes-from 429chain-proxy \
  -v $(pwd):/backup \
  busybox tar cvf /backup/data-backup.tar /app/data
```

---

## 7. Error Handling

The proxy returns OpenAI-compatible error responses for all failures.

### Error Response Format

All errors follow this structure:

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

### Common Error Codes

| Status | Code | Type | Description |
|--------|------|------|-------------|
| 401 | `invalid_api_key` | `invalid_request_error` | Authentication failed |
| 400 | `invalid_request` | `invalid_request_error` | Malformed request body |
| 503 | `all_providers_exhausted` | `service_unavailable` | All chain entries failed or rate limited |
| 500 | `internal_error` | `server_error` | Internal proxy error |

### All Providers Exhausted

When all entries in a chain fail or are rate limited, the proxy returns a 503 error:

**Status:** 503 Service Unavailable

**Body:**

```json
{
  "error": {
    "message": "All providers in chain exhausted",
    "type": "service_unavailable",
    "param": null,
    "code": "all_providers_exhausted"
  }
}
```

### Response Headers

Successful responses include informational headers:

- `X-429chain-Provider`: Provider and model that handled the request (format: `provider-id/model`)
- `X-429chain-Attempts`: Number of attempts before success (1 = first try, 2 = failed once then succeeded, etc.)

**Example:**

```
X-429chain-Provider: groq/llama-3.1-8b-instant
X-429chain-Attempts: 2
```

This indicates the request succeeded on the second attempt (first provider was rate limited, second succeeded).

---

## 8. How Waterfall Works

The waterfall mechanism ensures requests never fail due to rate limits when free tokens exist somewhere in the chain.

### Chain Resolution

1. **Client sends request** with a `model` field
2. **Proxy checks if `model` matches a chain name**
   - If yes: Use that chain
   - If no: Use `defaultChain` from config
3. **Chain is resolved** to an ordered list of provider+model pairs

### Waterfall Execution

The proxy attempts each entry in the chain sequentially:

1. **Try first entry** (provider+model pair)
2. **If successful:** Return response immediately
3. **If rate limited (429 or quota exceeded):**
   - Mark provider+model as exhausted with cooldown
   - Try next entry in chain
4. **If error (not rate limit):** Try next entry
5. **If all entries fail/exhausted:** Return 503 error

### Rate Limit Tracking

The proxy tracks rate limits using two methods:

**1. Header-based (preferred):**

Providers like Groq, OpenRouter, and Cerebras return rate limit headers:

- `x-ratelimit-remaining-requests` / `x-ratelimit-limit-requests`
- `x-ratelimit-remaining-tokens` / `x-ratelimit-limit-tokens`
- `x-ratelimit-reset-requests` / `x-ratelimit-reset-tokens`

The proxy parses these headers and proactively skips exhausted providers.

**2. Manual limits (fallback):**

When headers are unavailable, the proxy uses manual `rateLimits` from config:

```yaml
providers:
  - id: groq
    rateLimits:
      requestsPerMinute: 30
      tokensPerMinute: 15000
```

Manual limits are window-based counters that reset after the time window elapses.

### Cooldown Behavior

When a provider returns a 429 or runs out of quota:

1. **Provider+model pair is marked as exhausted**
2. **Cooldown timer is set** (default: 60 seconds, configurable via `cooldownDefaultMs`)
3. **During cooldown:** Provider+model is skipped in waterfall
4. **After cooldown:** Provider+model becomes available again

### Three-State Model

Each provider+model pair has one of three states:

- **available:** Not tracked yet or has full quota
- **tracking:** Quota is being tracked (some capacity used)
- **exhausted:** Rate limited or quota depleted (in cooldown)

### Example Waterfall Flow

**Config:**

```yaml
chains:
  - name: default
    entries:
      - provider: openrouter
        model: "llama-3.1-8b:free"
      - provider: groq
        model: "llama-3.1-8b-instant"
      - provider: cerebras
        model: "llama-3.1-8b"
```

**Request flow:**

1. Client sends request with `model: "default"`
2. Proxy tries OpenRouter first
3. OpenRouter returns 429 (rate limited)
4. OpenRouter/llama-3.1-8b:free marked exhausted for 60 seconds
5. Proxy tries Groq
6. Groq succeeds
7. Response returned with headers:
   - `X-429chain-Provider: groq/llama-3.1-8b-instant`
   - `X-429chain-Attempts: 2`

**Next request (within 60 seconds):**

1. Client sends another request
2. Proxy skips OpenRouter (still in cooldown)
3. Proxy tries Groq directly
4. Groq succeeds
5. Response returned with:
   - `X-429chain-Provider: groq/llama-3.1-8b-instant`
   - `X-429chain-Attempts: 1`

This ensures zero downtime from rate limits as long as at least one provider in the chain has available quota.

---

## Support

For issues and feature requests, visit the GitHub repository.
