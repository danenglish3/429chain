# 429chain

## What This Is

An open-source OpenAI-compatible proxy that maximizes free AI inference tokens by intelligently waterfalling requests through configurable provider+model chains. When one provider's free tier is exhausted (429), it seamlessly moves to the next. Built for developers who want to get the most out of free inference from platforms like OpenRouter, Groq, and Cerebras.

## Core Value

Requests never fail due to rate limits when free tokens exist somewhere in the chain — the system always finds a working provider.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] OpenAI-compatible proxy endpoint (drop-in replacement for any OpenAI SDK)
- [ ] Configurable chains of ordered provider+model pairs
- [ ] Waterfall routing: on 429 or failure, try next chain entry
- [ ] Streaming (SSE) support for all proxied requests
- [ ] Proactive rate limit tracking from response headers (x-ratelimit-remaining, etc.)
- [ ] Manual rate limit configuration as fallback (RPM, daily token limits per provider)
- [ ] Reactive rate limit learning from 429 responses
- [ ] In-memory tracking of temporarily exhausted providers (cooldown timers)
- [ ] API key gated access to the proxy
- [ ] Web UI: manage providers (add with API keys, see available models)
- [ ] Web UI: manage chains (add/remove/reorder provider+model pairs)
- [ ] Web UI: usage dashboard (per-provider totals, per-chain totals, request log, rate limit status)
- [ ] Web UI: test endpoint (send prompt, see which provider served it)
- [ ] Token usage tracking per provider and per chain
- [ ] Request logging (provider used, tokens consumed, latency)
- [ ] Docker deployment (docker-compose up)
- [ ] npm package deployment (install and run as CLI)

### Out of Scope

- Multi-user accounts / user management — API key gating is sufficient for v1
- Paid tier optimization / cost routing — this is about maximizing free tokens
- Mobile app — web UI only
- Provider auto-discovery — users manually add providers they have accounts with

## Context

- Target providers include OpenRouter, Groq, Cerebras, and similar platforms offering free inference tiers
- Free tiers have varying rate limits: per-minute RPM, daily token caps, concurrent request limits
- Rate limit headers vary by provider but commonly use x-ratelimit-remaining, x-ratelimit-reset patterns
- The caller doesn't specify a model — the chain configuration determines which provider+model pairs to try and in what order
- This is an open-source project aimed at the developer community

## Constraints

- **Tech stack**: TypeScript/Node — chosen for ecosystem and developer familiarity
- **API compatibility**: Must be a drop-in replacement for OpenAI SDK (same endpoint shape, same SSE format)
- **Deployment**: Must support both Docker and npm install workflows
- **Storage**: Lightweight — no heavy database for v1 (config files + in-memory state + simple persistence for logs/stats)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| OpenAI-compatible proxy (not SDK) | Drop-in replacement means zero code changes for users | — Pending |
| TypeScript/Node | Fast development, huge ecosystem, familiar to target audience | — Pending |
| Config file + Web UI | Config for power users and CI, UI for ease of use | — Pending |
| API key gating (not multi-user) | Simple auth model, avoids user management complexity | — Pending |
| Chain = ordered provider+model pairs | Gives full control over fallback order, allows model downgrades | — Pending |

---
*Last updated: 2026-02-05 after initialization*
