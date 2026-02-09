<div align="center">

# 429chain

**Never hit a rate limit again.**

An OpenAI-compatible proxy that automatically waterfalls requests through multiple LLM providers when one hits a rate limit.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org)
[![npm version](https://img.shields.io/npm/v/429chain)](https://www.npmjs.com/package/429chain)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)

</div>

---

Free-tier LLM providers have strict rate limits. When you hit a limit, your request fails &mdash; even though other providers still have capacity. 429chain sits between your application and multiple LLM providers, automatically trying the next provider in a chain when one returns a 429, 402, or times out. Your application sees a single OpenAI-compatible API and never knows a failover happened.

```
Your App  -->  429chain  -->  Provider A (429!)
                          -->  Provider B (429!)
                          -->  Provider C (200) --> Response
```

## Features

- **OpenAI-compatible API** &mdash; drop-in replacement for any OpenAI SDK or client
- **Waterfall routing** &mdash; requests cascade through provider chains on rate limit, payment error, or timeout
- **Automatic rate limit tracking** &mdash; parses provider headers, proactively skips exhausted providers
- **Streaming support** &mdash; full SSE streaming with mid-stream failure recovery and waterfall
- **Web dashboard** &mdash; manage providers, chains, rate limits, and view request analytics
- **Any OpenAI-compatible provider** &mdash; built-in support for OpenRouter, Groq, Cerebras, OpenAI, plus a generic adapter for any compatible API
- **Manual rate limit fallback** &mdash; configure limits for providers that don't send headers
- **Response normalization** &mdash; optionally moves `reasoning_content` to `content` for reasoning models
- **Chain testing** &mdash; test every provider in a chain individually to verify connectivity
- **Docker ready** &mdash; single-container deployment with SQLite persistence

## Quick Start

### Install

```bash
npm install -g 429chain
```

Or run directly with npx:

```bash
npx 429chain
```

> **Requires** Node.js >= 20.0.0

### Initialize

```bash
429chain --init
```

This creates `config/config.yaml` from the example template.

### Configure

Edit `config/config.yaml` with your provider API keys:

```yaml
version: 1

settings:
  port: 3429
  apiKeys:
    - "change-me-to-a-secure-key"
  defaultChain: "default"

providers:
  - id: groq
    name: Groq
    type: groq
    apiKey: "gsk_your-key-here"
    timeout: 10000
    rateLimits:
      requestsPerMinute: 30
      tokensPerMinute: 15000

  - id: cerebras
    name: Cerebras
    type: cerebras
    apiKey: "csk-your-key-here"

  - id: openai
    name: OpenAI
    type: openai
    apiKey: "sk-your-openai-key-here"

chains:
  - name: default
    entries:
      - provider: groq
        model: "llama-3.1-8b-instant"
      - provider: cerebras
        model: "llama-3.1-8b"
      - provider: openai        # paid fallback
        model: "gpt-4o-mini"
```

### Start

```bash
429chain
```

### Use

Point any OpenAI SDK at `http://localhost:3429`:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3429/v1",
    api_key="change-me-to-a-secure-key",
)

response = client.chat.completions.create(
    model="default",  # chain name
    messages=[{"role": "user", "content": "Hello!"}],
)

print(response.choices[0].message.content)
```

```bash
curl http://localhost:3429/v1/chat/completions \
  -H "Authorization: Bearer change-me-to-a-secure-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "default",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

If Groq is rate-limited, the request automatically falls through to Cerebras, then OpenAI. The response includes headers showing what happened:

```
X-429chain-Provider: cerebras/llama-3.1-8b
X-429chain-Attempts: 2
```

## How It Works

### Waterfall Routing

Each **chain** is an ordered list of provider+model pairs. When a request comes in:

1. Try the first provider in the chain
2. On **429** (rate limit): mark provider exhausted with cooldown, try next
3. On **402** (payment required): mark provider exhausted for 5 minutes, try next
4. On **timeout**: try next (no cooldown &mdash; transient failure)
5. On **5xx**: try next (no cooldown)
6. First **200**: return the response
7. All failed: return **503** with `all_providers_exhausted`

### Rate Limit Tracking

429chain tracks rate limits per provider+model pair using a three-state model:

| State | Description |
|---|---|
| **available** | Not yet tracked or has full quota |
| **tracking** | Quota being tracked from provider headers |
| **exhausted** | Rate limited, in cooldown &mdash; skipped in waterfall |

Rate limits are tracked two ways:

- **Header-based** (preferred): Parses `x-ratelimit-*` and `retry-after` headers from provider responses
- **Manual fallback**: Uses `rateLimits` from config when headers aren't available

Exhausted providers are **proactively skipped** without wasting a request.

### Chain Selection

The `model` field in your request doubles as the chain selector:

- If `model` matches a chain name (e.g. `"default"`, `"fast"`) &mdash; that chain is used
- Otherwise &mdash; `defaultChain` from config is used, and `model` is passed through to the provider

### Mid-Stream Failure Recovery

Streaming requests (`stream: true`) validate the provider connection before returning to the client. If a stream fails mid-response, 429chain waterfalls to the next provider with escalating cooldowns (2min &rarr; 4min &rarr; 8min &rarr; 30min max).

## Providers

429chain includes adapters for these providers out of the box:

| Type | Provider | Default Base URL |
|---|---|---|
| `openrouter` | [OpenRouter](https://openrouter.ai) | `https://openrouter.ai/api/v1` |
| `groq` | [Groq](https://groq.com) | `https://api.groq.com/openai/v1` |
| `cerebras` | [Cerebras](https://cerebras.ai) | `https://api.cerebras.ai/v1` |
| `openai` | [OpenAI](https://openai.com) | `https://api.openai.com/v1` |
| `generic-openai` | Any OpenAI-compatible API | *(requires `baseUrl`)* |

The `generic-openai` type works with any provider that follows the OpenAI API spec:

```yaml
providers:
  - id: together
    name: Together AI
    type: generic-openai
    apiKey: "your-together-key"
    baseUrl: "https://api.together.xyz/v1"

  - id: deepinfra
    name: DeepInfra
    type: generic-openai
    apiKey: "your-deepinfra-key"
    baseUrl: "https://api.deepinfra.com/v1/openai"
```

Need custom header parsing or parameter handling? See the [Provider Adapter Guide](docs/PROVIDERS.md) for creating custom adapters.

## Configuration

Configuration is YAML-based. See [`config/config.example.yaml`](config/config.example.yaml) for a fully annotated template.

### Settings

| Field | Default | Description |
|---|---|---|
| `port` | `3429` | HTTP listen port |
| `apiKeys` | *required* | Bearer tokens for client authentication |
| `defaultChain` | *required* | Chain used when `model` doesn't match a chain name |
| `logLevel` | `info` | `debug` / `info` / `warn` / `error` |
| `cooldownDefaultMs` | `60000` | Default 429 cooldown when no `retry-after` header |
| `requestTimeoutMs` | `30000` | Global upstream request timeout |
| `normalizeResponses` | `false` | Move `reasoning_content` to `content` for reasoning models |

### Provider Options

| Field | Required | Description |
|---|---|---|
| `id` | Yes | Unique identifier |
| `name` | Yes | Display name |
| `type` | Yes | Adapter type (see [Providers](#providers)) |
| `apiKey` | Yes | Provider API key |
| `baseUrl` | No* | API endpoint (*required for `generic-openai`) |
| `timeout` | No | Per-provider timeout override (ms) |
| `rateLimits` | No | Manual rate limit fallback |

### Manual Rate Limits

For providers that don't send rate limit headers:

```yaml
rateLimits:
  requestsPerMinute: 30
  tokensPerMinute: 15000
  requestsPerDay: 14400
  concurrentRequests: 1
```

All fields are optional. Header-based tracking takes precedence when available.

## Docker

### Docker Compose (recommended)

```bash
cp config/config.example.yaml config/config.yaml
# Edit config/config.yaml with your API keys

docker compose up -d
```

This runs 429chain with:
- SQLite persistence via named Docker volume
- Health checks every 30 seconds
- Auto-restart on failure
- Writable config mount for admin API

### Docker Build

```bash
docker build -t 429chain .
docker run -p 3429:3429 \
  -v ./config/config.yaml:/app/config/config.yaml \
  -v 429chain-data:/app/data \
  429chain
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3429` | Host port for Docker port mapping |
| `CONFIG_PATH` | `/app/config/config.yaml` | Config file path inside container |
| `NODE_ENV` | `production` | Node environment |

## API

429chain exposes a fully OpenAI-compatible API. All `/v1/*` endpoints require Bearer token authentication. The `/health` endpoint is public.

### Core Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/chat/completions` | Chat completion (streaming supported) |
| `GET` | `/v1/models` | List available models |
| `GET` | `/health` | Health check (no auth) |

### Observability

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/stats/summary` | Overall usage summary |
| `GET` | `/v1/stats/providers` | Per-provider usage stats |
| `GET` | `/v1/stats/chains` | Per-chain usage stats |
| `GET` | `/v1/stats/requests` | Recent request logs |
| `GET` | `/v1/ratelimits` | Live rate limit status |

### Admin

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/admin/config` | Get current config (keys masked) |
| `PUT` | `/v1/admin/providers/:id` | Create/update provider |
| `DELETE` | `/v1/admin/providers/:id` | Delete provider |
| `PUT` | `/v1/admin/chains/:name` | Create/update chain |
| `DELETE` | `/v1/admin/chains/:name` | Delete chain |

### Testing

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/test/chain/:name` | Test each provider in a chain individually |

Response headers on successful requests:

- `X-429chain-Provider` &mdash; provider and model used (e.g. `groq/llama-3.1-8b-instant`)
- `X-429chain-Attempts` &mdash; number of providers tried before success

For complete API reference with request/response examples, see the [Usage Guide](docs/USAGE.md).

## Web Dashboard

429chain includes a built-in web dashboard for managing configuration and monitoring requests. Access it at `http://localhost:3429` when the proxy is running.

The dashboard provides:
- Provider and chain management with drag-and-drop ordering
- Live rate limit status across all providers
- Request log with expandable details
- Usage statistics and summary cards
- Chain testing interface

## Development

```bash
# Clone the repo
git clone https://github.com/your-username/429chain.git
cd 429chain

# Install dependencies
npm install
cd ui && npm install && cd ..

# Copy config
cp config/config.example.yaml config/config.yaml

# Start in dev mode (watches for changes)
npm run dev

# Run tests
npm test

# Type check
npm run typecheck

# Build for production
npm run build
```

### Project Structure

```
src/
  api/routes/          # Hono route handlers
  api/middleware/       # Auth and error handling
  chain/               # Waterfall routing engine
  providers/           # Provider adapters (OpenRouter, Groq, etc.)
  ratelimit/           # Rate limit tracker and cooldown manager
  persistence/         # SQLite database, request logger, aggregator
  streaming/           # SSE parser and streaming utilities
  config/              # YAML config loader and Zod schemas
  shared/              # Types, errors, logger

ui/src/
  pages/               # Dashboard, Providers, Chains, Test
  components/          # Reusable UI components
  lib/                 # API client and query keys
```

### Tech Stack

**Backend:** TypeScript, [Hono](https://hono.dev), SQLite ([better-sqlite3](https://github.com/WiseLibs/better-sqlite3)), [Zod](https://zod.dev), [Pino](https://getpino.io)

**Frontend:** React 19, [TanStack Query](https://tanstack.com/query), React Hook Form, [@dnd-kit](https://dndkit.com)

**Build:** [tsdown](https://github.com/nicolo-ribaudo/tsdown), [Vite](https://vite.dev)

## Contributing

Contributions are welcome! Here are some ways to get started:

- **Add a provider adapter** &mdash; see the [Provider Adapter Guide](docs/PROVIDERS.md) for a step-by-step walkthrough
- **Report bugs** &mdash; open an issue with reproduction steps
- **Suggest features** &mdash; open an issue describing the use case
- **Submit a PR** &mdash; fork the repo, create a branch, and open a pull request

Please make sure tests pass before submitting:

```bash
npm test
```

## Built With

This project was built entirely with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and the [Get Shit Done (GSD)](https://github.com/gsd-framework/gsd) plugin &mdash; an agentic workflow framework for Claude Code that handles planning, execution, and verification of complex software projects.

## License

[MIT](LICENSE)
