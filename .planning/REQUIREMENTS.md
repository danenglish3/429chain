# Requirements: 429chain

**Defined:** 2026-03-01
**Core Value:** Requests never fail due to rate limits when free tokens exist somewhere in the chain

## v1.1 Requirements

Requirements for SaaS-ready milestone. Each maps to roadmap phases.

### Dual-Mode Architecture

- [ ] **ARCH-01**: App initializes in self-hosted mode (SQLite, no auth) when APP_MODE is not set or set to "self-hosted"
- [ ] **ARCH-02**: App initializes in SaaS mode (Supabase Auth + Postgres) when APP_MODE=saas with required env vars
- [ ] **ARCH-03**: Repository interfaces abstract all data access (providers, chains, usage, logs)
- [ ] **ARCH-04**: SQLite repository implementation wraps existing logic with no behavior change
- [ ] **ARCH-05**: Supabase repository implementation uses Postgres with RLS-enforced tenant isolation
- [ ] **ARCH-06**: Repository factory selects implementation based on APP_MODE at startup
- [ ] **ARCH-07**: Self-hosted mode has zero dependency on Supabase packages at runtime

### Authentication

- [ ] **AUTH-01**: User can sign up with email and password in SaaS mode
- [ ] **AUTH-02**: User receives email verification after signup
- [ ] **AUTH-03**: User can log in with verified email and password
- [ ] **AUTH-04**: User session persists across browser refresh via Supabase token management
- [ ] **AUTH-05**: User can log out (clears session, redirects to login)
- [ ] **AUTH-06**: Hono middleware validates JWT on all protected API routes in SaaS mode
- [ ] **AUTH-07**: Proxy endpoint resolves tenant from per-tenant API key in SaaS mode

### Multi-Tenant Data

- [ ] **DATA-01**: Postgres schema includes user_id column on all tenant tables (providers, chains, chain_entries, request_logs)
- [ ] **DATA-02**: RLS policies enforce tenant isolation with USING and WITH CHECK clauses
- [ ] **DATA-03**: Unique constraints are tenant-scoped (e.g., UNIQUE(user_id, name))
- [ ] **DATA-04**: User receives a per-tenant proxy API key on account creation
- [ ] **DATA-05**: Each user can add their own provider API keys (BYOK) visible only to them
- [ ] **DATA-06**: Provider API keys are encrypted before storage in Postgres
- [ ] **DATA-07**: Proxy routes requests using the calling tenant's provider keys and chains
- [ ] **DATA-08**: Usage logs and request history are scoped to the authenticated tenant

### Web UI

- [ ] **UI-01**: Login page with email/password form and error states
- [ ] **UI-02**: Signup page with email/password form and post-signup "check your email" state
- [ ] **UI-03**: All app routes redirect to login when no session exists
- [ ] **UI-04**: Existing provider, chain, dashboard, and test pages show only the authenticated user's data
- [ ] **UI-05**: Self-hosted mode shows no login UI (direct access as today)

### Deployment

- [ ] **DEPLOY-01**: Docker Compose updated with SaaS mode configuration (Supabase env vars)
- [ ] **DEPLOY-02**: Environment variables documented for both self-hosted and SaaS modes
- [ ] **DEPLOY-03**: Single Docker image serves both modes based on env vars

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Accounts

- **ACCT-01**: User can reset password via email link
- **ACCT-02**: User can view and regenerate proxy API key in account settings
- **ACCT-03**: User can change email address
- **ACCT-04**: User can change password

### Teams

- **TEAM-01**: User can create an organization
- **TEAM-02**: User can invite members to organization
- **TEAM-03**: Organization members share providers and chains

### Billing

- **BILL-01**: User can subscribe to a paid plan
- **BILL-02**: Usage is tracked against plan limits
- **BILL-03**: User can manage billing in account settings

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| OAuth / social login (Google, GitHub) | Email/password sufficient for v1.1; Supabase makes adding OAuth later a one-line config change |
| Team / organization accounts | Doubles scope with tenant-within-tenant modeling, RBAC, invitation flows |
| Billing / paid tiers | Own milestone; premature billing integration creates technical debt |
| Admin dashboard / user management UI | Supabase dashboard sufficient for operator; build when user count warrants it |
| Shared provider pools | BYOK only; avoids key leakage risk and quota attribution complexity |
| Customer-managed encryption keys | Enterprise-grade complexity (KMS/Tenant Security Proxy); v3+ |
| Invite-only / waitlist signup | Adds auth complexity without clear retention benefit for a developer tool |
| Mobile app | Web UI only |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ARCH-01 | — | Pending |
| ARCH-02 | — | Pending |
| ARCH-03 | — | Pending |
| ARCH-04 | — | Pending |
| ARCH-05 | — | Pending |
| ARCH-06 | — | Pending |
| ARCH-07 | — | Pending |
| AUTH-01 | — | Pending |
| AUTH-02 | — | Pending |
| AUTH-03 | — | Pending |
| AUTH-04 | — | Pending |
| AUTH-05 | — | Pending |
| AUTH-06 | — | Pending |
| AUTH-07 | — | Pending |
| DATA-01 | — | Pending |
| DATA-02 | — | Pending |
| DATA-03 | — | Pending |
| DATA-04 | — | Pending |
| DATA-05 | — | Pending |
| DATA-06 | — | Pending |
| DATA-07 | — | Pending |
| DATA-08 | — | Pending |
| UI-01 | — | Pending |
| UI-02 | — | Pending |
| UI-03 | — | Pending |
| UI-04 | — | Pending |
| UI-05 | — | Pending |
| DEPLOY-01 | — | Pending |
| DEPLOY-02 | — | Pending |
| DEPLOY-03 | — | Pending |

**Coverage:**
- v1.1 requirements: 30 total
- Mapped to phases: 0
- Unmapped: 30 ⚠️

---
*Requirements defined: 2026-03-01*
*Last updated: 2026-03-01 after initial definition*
