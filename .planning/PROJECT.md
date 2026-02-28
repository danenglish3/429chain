# 429chain

## What This Is

An OpenAI-compatible proxy that maximizes free AI inference tokens by intelligently waterfalling requests through configurable provider+model chains. When one provider's free tier is exhausted (429), it seamlessly moves to the next. Available as both a self-hosted open-source tool (SQLite, single user) and a multi-tenant SaaS (Supabase Auth + Postgres, per-user isolation). Includes a web UI for management, observability, Docker deployment, and CLI support via npm/npx.

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

- Dual deployment modes: self-hosted (SQLite, single user) and SaaS (Supabase, multi-tenant)
- Supabase Auth integration: email/password signup, session management, protected routes
- Multi-tenant Postgres data layer with row-level security via Supabase
- BYOK (bring your own keys): each user manages their own provider API keys
- Web UI: login/signup flows, tenant-scoped views
- Database abstraction layer: repository pattern switching between SQLite and Postgres
- Cloud deployment configuration (env-driven mode selection)

## Current Milestone: v1.1 SaaS Ready

**Goal:** Make 429chain deployable as a multi-tenant SaaS while preserving the existing self-hosted open-source experience.

**Target features:**
- Dual-mode architecture (self-hosted SQLite vs SaaS Postgres)
- Supabase Auth (email/password) with session management
- Multi-tenant data isolation (providers, chains, usage, logs per user)
- BYOK provider keys per tenant
- Updated Web UI with auth flows and tenant-scoped views
- Cloud-ready deployment config

### Out of Scope

- Billing / paid plans — free for now, billing deferred to future milestone
- Paid tier optimization / cost routing — this is about maximizing free tokens
- Mobile app — web UI only
- Provider auto-discovery — users manually add providers they have accounts with
- Shared provider pools — BYOK only, no centrally managed keys
- Admin dashboard / user management UI — defer to future milestone

## Context

- Shipped v1.0 with 9,214 LOC TypeScript + CSS across 77 files
- Phase 8 added queue mode (requests wait when all providers exhausted)
- Tech stack: Node.js, Hono, TypeScript (ESM), SQLite (better-sqlite3), React 19 + Vite
- 88 tests passing, TypeScript strict mode
- Target providers: OpenRouter, Groq, Cerebras, and generic OpenAI-compatible
- Deployable via Docker (docker-compose up) or npm/npx CLI
- SaaS target: Supabase for auth (email/password) and Postgres data layer
- Self-hosted mode must remain fully functional with zero Supabase dependency

## Constraints

- **Tech stack**: TypeScript/Node (ESM-only, NodeNext module resolution)
- **API compatibility**: Drop-in replacement for OpenAI SDK (same endpoint shape, same SSE format)
- **Deployment**: Docker and npm/npx CLI workflows supported
- **Storage**: SQLite with WAL mode (self-hosted) or Postgres via Supabase (SaaS), YAML config files
- **Backward compatibility**: Self-hosted mode unchanged — no new dependencies required
- **Auth**: Supabase Auth for SaaS mode; single API key for self-hosted mode

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

| Dual-mode architecture (SQLite + Postgres) | Keep self-hosted zero-dependency while adding SaaS capabilities | — Pending |
| Supabase for auth + data | Single platform for auth and multi-tenant Postgres, reduces integration surface | — Pending |
| BYOK only (no shared pools) | Avoids key management complexity, clear user responsibility | — Pending |

---
*Last updated: 2026-03-01 after v1.1 milestone start*
