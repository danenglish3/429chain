# Feature Research

**Domain:** Multi-tenant SaaS capabilities for AI inference proxy (developer tool)
**Researched:** 2026-03-01
**Confidence:** HIGH (live research via WebSearch/WebFetch; Supabase official docs verified)

---

## Scope Note

This file covers ONLY the new features needed for v1.1 SaaS multi-tenancy.
v1.0 features (proxy engine, waterfall routing, streaming, web UI, Docker, CLI, queue mode)
are already shipped and documented in the original FEATURES.md (dated 2026-02-05).

The question this file answers: what does a multi-tenant SaaS layer look like for a
developer proxy tool, and which features are table stakes vs differentiators vs anti-features?

---

## Feature Landscape

### Table Stakes (Users Expect These)

Every multi-tenant SaaS for a developer tool must have these. Missing any = product feels
broken or unsafe. Users comparing against competitors (LiteLLM Pro, Portkey, Helicone) expect
all of these at launch.

| Feature | Why Expected | Complexity | v1.0 Dependency |
|---------|--------------|------------|-----------------|
| **Email/password signup** | Standard entry point for a developer SaaS; users expect to create an account with email + password and verify email before accessing the product | LOW | None — new auth layer entirely |
| **Email verification flow** | Security hygiene; users expect a confirmation email before they can use their account; Supabase Auth provides this out of the box | LOW | None — Supabase handles email send |
| **Persistent login sessions** | Users expect to stay logged in across browser refreshes; JWT + refresh token pattern with secure cookies | LOW | None — Supabase session management |
| **Protected UI routes** | Pages like the chain editor and dashboard must redirect to login if no session exists; users expect this | LOW | Depends on: auth session context in React |
| **Tenant-scoped data** | Every user sees only their own providers, chains, usage logs — never another user's data; this is a hard expectation | MEDIUM | Depends on: database abstraction layer (SQLite → Postgres) |
| **BYOK provider keys per tenant** | Each user manages their own API keys for OpenRouter, Groq, Cerebras, etc.; keys are never shared or visible across tenants | MEDIUM | Depends on: existing provider management UI (v1.0) |
| **Proxy API key per tenant** | Each user gets their own proxy access token to use in their OpenAI SDK `api_key` field; requests through the proxy are routed to that user's chains | MEDIUM | Depends on: existing API key gating (v1.0) |
| **Logout** | Users expect a logout button that clears session and redirects to login | LOW | None — Supabase `signOut()` |
| **Self-hosted mode unchanged** | Existing self-hosted users must not be affected; zero new dependencies introduced in self-hosted mode | MEDIUM | Everything — this is a cross-cutting constraint |
| **Login page / auth UI** | A dedicated login and signup page separate from the main app; auth routes must be public, app routes must be gated | LOW | Depends on: React Router or equivalent |

### Differentiators (Competitive Advantage)

Features that make 429chain's SaaS offering stand out. Not universally expected at launch,
but they drive adoption and reduce churn for a developer-focused proxy tool.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Zero-friction BYOK onboarding** | The signup → first API request flow should be under 5 minutes: sign up, add one provider key, get one chain, copy a proxy URL, done. Competitors like LiteLLM require self-hosting; Portkey requires enterprise contact for advanced features. | MEDIUM | Onboarding UX design matters more than the feature set here. The flow should guide users from empty state to first proxied request. |
| **Tenant-scoped proxy endpoint** | Each user's proxy endpoint includes a tenant-specific path or uses their per-tenant API key to route to their chains — no shared routing tables. This is cleaner than virtual key systems in LiteLLM and directly mirrors how developers use the OpenAI SDK. | MEDIUM | Pattern: `Authorization: Bearer <per-tenant-proxy-key>` — same header as v1.0 but now tenant-resolved server-side. |
| **Instant mode switching (self-hosted → SaaS)** | Power users who started with the self-hosted version can migrate to the SaaS by pointing at a new URL; no data migration required since BYOK means they just re-enter their provider keys. Low friction upgrade path. | LOW | Architectural: the proxy API is identical; only the auth mechanism and data backend change. Users just change their `baseURL` in their SDK. |
| **Per-tenant usage isolation in the dashboard** | Each user's web UI shows only their own usage, rate limit state, and request logs. This is what the v1.0 usage dashboard does, but scoped to the tenant. Competitors in SaaS mode show org-level aggregates; per-user clarity is rarer. | LOW | Depends on: existing usage dashboard (v1.0) + tenant filter on all queries |
| **Env-var driven mode selection** | Operators deploy one Docker image; `APP_MODE=saas` or `APP_MODE=self-hosted` (plus Supabase env vars) determines the mode. No code forks, no separate Docker images. This is the repository-pattern abstraction. | HIGH | This is the core architecture of the v1.1 milestone. The "mode flag" approach is used by tools like Flagsmith and Unleash for their dual-deployment models. |

### Anti-Features (Commonly Requested, Often Problematic)

Features users will ask for that seem reasonable but create problems for this milestone.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Organization / team accounts** | "I want to share my chain config with my team" | Full team/org management requires tenant-within-tenant modeling, invitation flows, RBAC, member management UI — doubles the scope of v1.1. No competitor gets this right quickly. | v1.1 is one user = one tenant. Each team member runs their own account. Team features are v2+. |
| **OAuth / social login (Google, GitHub)** | "I don't want to create another password" | Adding OAuth providers doubles the auth surface area and requires per-provider OAuth app registration, callback URL management, and token handling edge cases. Supabase supports OAuth but each provider needs setup and testing. | Email/password is sufficient for v1.1. Supabase makes adding OAuth later a one-line config change — defer cleanly. |
| **Admin dashboard for user management** | "I need to see all my users and their usage" | An admin UI (list all tenants, view their data, suspend accounts) is a separate product surface with its own access control requirements. It's useful for an operator but not for end users. | Defer entirely. Supabase's own dashboard provides user visibility for the operator. Build admin tooling only when the platform has users worth managing. |
| **Billing and paid tiers** | "How do I monetize this?" | Billing (Stripe integration, subscription management, feature gating, invoice handling) is a complete milestone on its own. Premature billing integration creates technical debt when pricing strategy changes. | Out of scope for v1.1 per PROJECT.md. Build auth + data layer first; billing plugs in after. |
| **Provider key encryption at rest (KMS/BYOK encryption)** | "My provider keys should be encrypted with my own key" | True BYOK encryption (where the tenant holds their own encryption key and the SaaS operator cannot decrypt) requires a Tenant Security Proxy or KMS integration — this is a major architecture addition. AWS, IronCore Labs, Baffle.io all offer this but it's enterprise-grade complexity. | Supabase encrypts data at rest by default. Postgres column-level encryption with a server-managed key is sufficient for v1.1. True customer-managed encryption is a v3+ enterprise feature. |
| **Shared provider pools** | "Pool everyone's API keys for higher rate limits" | Shared key pools create liability (one user exhausting another's quota), key leakage risk, and complex attribution logic. Explicitly out of scope per PROJECT.md. | BYOK only. Each tenant's keys are isolated. The value prop is personal free-tier maximization, not shared pool economics. |
| **Signup with invite-only / waitlist** | "Create scarcity for the launch" | Waitlist/invite flows add auth complexity (invite token storage, expiry, redemption) and delay user activation. No evidence this drives better retention for a developer tool. | Open signup. Let users in immediately after email verification. |

---

## Feature Dependencies

```
[Supabase Auth: email/password signup]
    └──enables──> [Authenticated session (JWT)]
                      └──enables──> [Protected React routes]
                      └──enables──> [tenant_id from JWT claims]
                                        └──enables──> [RLS policy enforcement]
                                                           └──isolates──> [Providers table (per tenant)]
                                                           └──isolates──> [Chains table (per tenant)]
                                                           └──isolates──> [Usage/logs table (per tenant)]

[Database abstraction layer (repository pattern)]
    └──required by──> [Supabase Postgres (SaaS mode)]
    └──required by──> [SQLite (self-hosted mode, unchanged)]
    └──enables──> [Dual-mode: same app code, different storage backend]

[Per-tenant proxy API key]
    └──requires──> [User account (Supabase Auth)]
    └──extends──> [v1.0 API key gating]
    └──enables──> [Proxy request routed to tenant's chains]

[BYOK provider key management per tenant]
    └──requires──> [tenant_id isolation (RLS)]
    └──extends──> [v1.0 provider management UI]
    └──requires──> [Database abstraction layer]

[Web UI: login/signup pages]
    └──requires──> [Supabase Auth]
    └──enables──> [Web UI: tenant-scoped views (provider list, chain editor, dashboard)]

[APP_MODE env var]
    └──gates──> [Supabase client initialization (SaaS only)]
    └──gates──> [RLS-aware Postgres queries (SaaS only)]
    └──preserves──> [SQLite path (self-hosted, zero change)]

[v1.0: provider management UI] ──extended by──> [BYOK per tenant]
[v1.0: chain editor UI]        ──extended by──> [tenant-scoped chains]
[v1.0: usage dashboard]        ──extended by──> [per-tenant usage filter]
[v1.0: API key gating]         ──extended by──> [per-tenant proxy API key]
```

### Dependency Notes

- **Auth must come before tenant data isolation.** Without a user session, there is no
  `user_id` / `tenant_id` to enforce RLS policies on. Supabase Auth provides the JWT that
  Postgres RLS policies read via `auth.uid()`.

- **Database abstraction layer is the highest-risk dependency.** The entire v1.1 milestone
  depends on cleanly switching between SQLite (self-hosted) and Postgres/Supabase (SaaS) at
  the repository layer without changing business logic. This must be designed first.

- **Per-tenant proxy API key extends v1.0 API key gating, not replaces it.** The mechanism
  is the same (`Authorization: Bearer <key>`); the difference is that the key is now
  associated with a user account in Postgres instead of a static env var. Self-hosted mode
  continues using the env var approach.

- **v1.0 UI components are extended, not rewritten.** The provider management page, chain
  editor, and usage dashboard already exist. They need to be wrapped with auth context and
  have their data queries scoped to the current tenant. No full rewrites required.

- **RLS is defense-in-depth, not the only layer.** Application-level tenant filtering
  (always pass `user_id` in queries) is required even with RLS active. RLS prevents data
  leaks if the app layer has a bug; it doesn't replace correct application-level scoping.

---

## MVP Definition

### Launch With (v1.1)

The minimum required to ship a working multi-tenant SaaS while preserving self-hosted mode.

- [ ] **APP_MODE env var with dual-path initialization** — gates Supabase client; self-hosted
  path unchanged
- [ ] **Database abstraction layer (repository pattern)** — same interface, SQLite or Postgres
  backend; required before any other v1.1 feature
- [ ] **Supabase Auth: email/password signup with email verification** — standard Supabase
  `signUp()` + `signInWithPassword()` flow
- [ ] **Persistent JWT sessions with refresh** — Supabase session management, secure cookie
  storage for SSR or localStorage for SPA
- [ ] **Protected React routes** — redirect unauthenticated users to `/login`; all app routes
  require valid session
- [ ] **Login and signup pages** — minimal UI, functional forms, error states
- [ ] **Postgres schema with RLS** — `providers`, `chains`, `usage`, `logs` tables with
  `user_id` column; RLS policies enforcing `auth.uid() = user_id`
- [ ] **Tenant-scoped data queries** — all reads/writes include `user_id` filter; no
  cross-tenant data leakage
- [ ] **Per-tenant proxy API key** — generated on account creation, stored in DB, used to
  resolve tenant context on proxy requests
- [ ] **BYOK provider keys per tenant** — provider records in Postgres include `user_id`;
  proxy routes requests using the calling tenant's provider keys
- [ ] **Logout** — `supabase.auth.signOut()` + redirect to login
- [ ] **Cloud deployment config** — env vars documented; Supabase URL/key injected at deploy
  time; Docker Compose updated for SaaS mode

### Add After Validation (v1.x)

Features to add once the SaaS is running with real users.

- [ ] **Password reset flow** — "Forgot password" email link; Supabase provides this but it
  needs UI. Trigger: first user reports being locked out.
- [ ] **Account settings page** — change email, change password, view/regenerate proxy API
  key. Trigger: first user requests key rotation.
- [ ] **Usage quota display** — show per-provider rate limit status in context of the tenant's
  own keys. Already exists in v1.0 dashboard; just needs tenant-scoped wiring.
- [ ] **Admin user list (read-only)** — basic operator view of registered accounts. Trigger:
  user management becomes necessary.

### Future Consideration (v2+)

- [ ] **Team/org accounts** — one account, multiple members with roles; full v2 milestone
- [ ] **OAuth login (Google, GitHub)** — Supabase supports it; add when email/password proves
  friction
- [ ] **Billing integration** — Stripe subscriptions, feature gating by plan; own milestone
- [ ] **Customer-managed encryption keys** — true BYOK encryption (not just BYOK API keys);
  enterprise tier only
- [ ] **SSO / SAML** — enterprise buyer requirement; post-billing milestone

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Database abstraction layer | HIGH (enables everything) | HIGH | P1 — build first |
| APP_MODE env var gating | HIGH (preserves self-hosted) | LOW | P1 — build first |
| Supabase Auth signup/login | HIGH | LOW | P1 |
| Protected React routes | HIGH | LOW | P1 |
| Postgres schema + RLS | HIGH | MEDIUM | P1 |
| Per-tenant proxy API key | HIGH | MEDIUM | P1 |
| BYOK provider keys per tenant | HIGH | MEDIUM (extends v1.0 UI) | P1 |
| Tenant-scoped queries (providers, chains, logs) | HIGH | MEDIUM | P1 |
| Login/signup UI pages | HIGH | LOW | P1 |
| Logout | HIGH | LOW | P1 |
| Email verification | MEDIUM | LOW (Supabase default) | P1 |
| Cloud deployment config/docs | MEDIUM | LOW | P1 |
| Password reset flow | MEDIUM | LOW | P2 |
| Account settings page | MEDIUM | LOW | P2 |
| Admin user list | LOW | LOW | P3 |
| Team/org accounts | HIGH | VERY HIGH | P4 (v2+) |
| OAuth login | MEDIUM | MEDIUM | P4 (v2+) |
| Billing | HIGH | VERY HIGH | P4 (own milestone) |

**Priority key:**
- P1: Required for v1.1 launch
- P2: Add after validation
- P3: Nice to have, future
- P4: Future milestone

---

## Competitor Feature Analysis

How LLM gateway competitors handle the multi-tenant dimension:

| Feature | LiteLLM | Portkey | Helicone | 429chain v1.1 |
|---------|---------|---------|----------|---------------|
| **Multi-tenant auth** | Virtual keys (not real user accounts) | Full org/project auth with SSO | API key per account | Supabase email/password; real user accounts |
| **BYOK provider keys** | Users configure provider keys in a shared config or per-virtual-key | "Virtual keys" map to provider keys per org | Pass-through proxy; keys in config | Per-user in Postgres with RLS; truly isolated |
| **Tenant data isolation** | Weak (config-based, not DB-level) | Project-level isolation | API-key-level isolation | RLS-enforced at Postgres query level |
| **Self-hosted option** | Yes (main product is self-hosted) | Yes (enterprise only) | Yes (open source) | Yes — first-class, zero Supabase dependency |
| **SaaS offering** | LiteLLM cloud (enterprise) | SaaS primary offering | SaaS primary offering | Planned for v1.1; simple BYOK, no shared pools |
| **Dual mode (same codebase)** | No (different products) | No | No | Yes — APP_MODE flag, repository pattern |
| **Onboarding speed** | Slow (complex config) | Moderate (UI-guided) | Fast | Target: <5 min from signup to first proxied request |
| **Free tier** | Self-hosted only | Limited | Self-host or paid | SaaS is free; billing deferred to v2 |

### Competitive Positioning

429chain's SaaS offering occupies a specific position: truly isolated BYOK (each user's
provider keys are database-isolated by RLS, not just config-separated), a self-hosted mode
that remains fully functional, and a codebase that serves both from a single deployment
artifact via env var mode selection.

LiteLLM's "virtual keys" are not true user accounts — they're access tokens mapped to
budget configs, not isolated tenants. Portkey's multi-tenancy is project-scoped but requires
their SaaS. Helicone is observability-first, not a routing proxy. None of these combine
genuine per-user isolation with a first-class self-hosted alternative in a single deployable.

---

## User Flows

### Flow 1: New User Signup (SaaS Mode)

```
Landing page → Sign Up
  → Enter email + password
  → Receive verification email → Click link
  → Redirected to app (session active)
  → Empty state: "Add your first provider"
  → Add provider (e.g., OpenRouter) + paste API key → Save
  → Auto-created default chain with that provider
  → Copy proxy URL + proxy API key
  → Update OpenAI SDK: baseURL = proxy URL, apiKey = proxy key
  → Make first request → see it in the dashboard
```

### Flow 2: Returning User Login

```
Navigate to app → Redirect to /login (no session)
  → Enter email + password
  → Session restored → Redirect to dashboard
  → See existing providers, chains, recent usage
```

### Flow 3: Provider Key Management (Per-Tenant BYOK)

```
Settings → Providers
  → "Add Provider" → Select type (OpenRouter / Groq / Cerebras / Custom)
  → Paste provider API key → Save
  → Key stored in Postgres providers table with user_id
  → Key used by proxy ONLY for this user's requests
  → Update or delete key: available in provider settings
  → Key never visible to other tenants (RLS enforced at DB)
```

### Flow 4: Self-Hosted User (Mode Unchanged)

```
docker-compose up (APP_MODE=self-hosted or not set)
  → No Supabase dependency initialized
  → API_KEY env var gates access (v1.0 behavior)
  → SQLite backend (v1.0 behavior)
  → All v1.0 features work identically
  → No login page shown; direct access to UI
```

### Flow 5: SaaS Deployment (Operator)

```
Set env vars: APP_MODE=saas, SUPABASE_URL=..., SUPABASE_ANON_KEY=..., SUPABASE_SERVICE_KEY=...
docker-compose up (or npm start)
  → App initializes Supabase client
  → Auth middleware active on proxy endpoint
  → All UI routes protected
  → Postgres used for all data storage with RLS active
```

---

## Sources

- [The developer's guide to SaaS multi-tenant architecture — WorkOS](https://workos.com/blog/developers-guide-saas-multi-tenant-architecture) — MEDIUM confidence (competitor blog, good pattern overview)
- [Build a multi-tenant SaaS application — Logto](https://blog.logto.io/build-multi-tenant-saas-application) — MEDIUM confidence (verified via WebFetch; accurate pattern description)
- [Supabase Row Level Security docs](https://supabase.com/docs/guides/database/postgres/row-level-security) — HIGH confidence (official Supabase docs)
- [Supabase Auth: Password-based Auth](https://supabase.com/docs/guides/auth/passwords) — HIGH confidence (official Supabase docs)
- [Supabase User Sessions](https://supabase.com/docs/guides/auth/sessions) — HIGH confidence (official Supabase docs)
- [Multi-Tenant Applications with RLS on Supabase — Antstack](https://www.antstack.com/blog/multi-tenant-applications-with-rls-on-supabase-postgress/) — MEDIUM confidence (community article, consistent with official docs)
- [Top LLM Gateways 2025 — Helicone blog](https://www.helicone.ai/blog/top-llm-gateways-comparison-2025) — HIGH confidence (verified via WebFetch; competitor feature comparison)
- [Enforcing RLS in Supabase — DEV Community](https://dev.to/blackie360/-enforcing-row-level-security-in-supabase-a-deep-dive-into-lockins-multi-tenant-architecture-4hd2) — MEDIUM confidence (practical implementation details)
- [API authentication in B2B SaaS — Scalekit](https://www.scalekit.com/blog/api-authentication-b2b-saas) — MEDIUM confidence (API key scoping patterns)
- [Building a Self-Hostable Application — FusionAuth](https://fusionauth.io/blog/building-self-hostable-application) — MEDIUM confidence (dual-mode deployment patterns)

---
*Feature research for: Multi-tenant SaaS layer on AI inference proxy*
*Researched: 2026-03-01*
