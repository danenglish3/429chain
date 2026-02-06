# 429chain

## What This Is

An open-source OpenAI-compatible proxy that maximizes free AI inference tokens by intelligently waterfalling requests through configurable provider+model chains. When one provider's free tier is exhausted (429), it seamlessly moves to the next. Includes a web UI for management, SQLite-backed observability, Docker deployment, and CLI support via npm/npx. Built for developers who want to get the most out of free inference from platforms like OpenRouter, Groq, and Cerebras.

## Core Value

Requests never fail due to rate limits when free tokens exist somewhere in the chain — the system always finds a working provider.

## Requirements

### Validated

- OpenAI-compatible proxy endpoint (drop-in replacement for any OpenAI SDK) — v1.0
- Configurable chains of ordered provider+model pairs — v1.0
- Waterfall routing: on 429 or failure, try next chain entry — v1.0
- Streaming (SSE) support for all proxied requests — v1.0
- Proactive rate limit tracking from response headers (x-ratelimit-remaining, etc.) — v1.0
- Manual rate limit configuration as fallback (RPM, daily token limits per provider) — v1.0
- Reactive rate limit learning from 429 responses — v1.0
- In-memory tracking of temporarily exhausted providers (cooldown timers) — v1.0
- API key gated access to the proxy — v1.0
- Web UI: manage providers (add with API keys, see available models) — v1.0
- Web UI: manage chains (add/remove/reorder provider+model pairs) — v1.0
- Web UI: usage dashboard (per-provider totals, per-chain totals, request log, rate limit status) — v1.0
- Web UI: test endpoint (send prompt, see which provider served it) — v1.0
- Token usage tracking per provider and per chain — v1.0
- Request logging (provider used, tokens consumed, latency) — v1.0
- Docker deployment (docker-compose up) — v1.0
- npm package deployment (install and run as CLI) — v1.0

### Active

(None — v1.0 shipped. Define next milestone requirements with /gsd:new-milestone)

### Out of Scope

- Multi-user accounts / user management — API key gating is sufficient
- Paid tier optimization / cost routing — this is about maximizing free tokens
- Mobile app — web UI only
- Provider auto-discovery — users manually add providers they have accounts with

## Context

- Shipped v1.0 with 9,214 LOC TypeScript + CSS across 77 files
- Tech stack: Node.js, Hono, TypeScript (ESM), SQLite (better-sqlite3), React 19 + Vite
- 88 tests passing, TypeScript strict mode
- Target providers: OpenRouter, Groq, Cerebras, and generic OpenAI-compatible
- Deployable via Docker (docker-compose up) or npm/npx CLI

## Constraints

- **Tech stack**: TypeScript/Node (ESM-only, NodeNext module resolution)
- **API compatibility**: Drop-in replacement for OpenAI SDK (same endpoint shape, same SSE format)
- **Deployment**: Docker and npm/npx CLI workflows supported
- **Storage**: SQLite with WAL mode for observability, YAML config files

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| OpenAI-compatible proxy (not SDK) | Drop-in replacement means zero code changes for users | Good |
| TypeScript/Node with Hono | Fast development, huge ecosystem, lightweight HTTP | Good |
| Config file + Web UI | Config for power users and CI, UI for ease of use | Good |
| API key gating (not multi-user) | Simple auth model, avoids user management complexity | Good |
| Chain = ordered provider+model pairs | Gives full control over fallback order, allows model downgrades | Good |
| SQLite with WAL mode | Concurrent reads during writes, file-based deployment simplicity | Good |
| tsdown ESM bundler | Fast builds, preserves import.meta.url, outputs .mjs | Good |
| util.parseArgs for CLI | No external dependencies, Node.js built-in | Good |
| import.meta.url for static paths | Works correctly when globally installed (cwd != package dir) | Good |

---
*Last updated: 2026-02-06 after v1.0 milestone*
