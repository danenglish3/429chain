# Roadmap: 429chain

## Milestones

- **v1.0 MVP** — Phases 1-7 (shipped 2026-02-06)

## Phases

<details>
<summary>v1.0 MVP (Phases 1-7) — SHIPPED 2026-02-06</summary>

- [x] Phase 1: Core Waterfall Proxy (4/4 plans) — completed 2026-02-05
- [x] Phase 2: SSE Streaming (2/2 plans) — completed 2026-02-05
- [x] Phase 3: Rate Limit Intelligence (4/4 plans) — completed 2026-02-05
- [x] Phase 4: Observability & Persistence (3/3 plans) — completed 2026-02-05
- [x] Phase 5: Web UI (6/6 plans) — completed 2026-02-06
- [x] Phase 6: Docker Deployment (3/3 plans) — completed 2026-02-06
- [x] Phase 7: CLI Support (3/3 plans) — completed 2026-02-06

See: `.planning/milestones/v1.0-ROADMAP.md` for full details.

</details>

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|---------------|--------|-----------|
| 1. Core Waterfall Proxy | v1.0 | 4/4 | Complete | 2026-02-05 |
| 2. SSE Streaming | v1.0 | 2/2 | Complete | 2026-02-05 |
| 3. Rate Limit Intelligence | v1.0 | 4/4 | Complete | 2026-02-05 |
| 4. Observability & Persistence | v1.0 | 3/3 | Complete | 2026-02-05 |
| 5. Web UI | v1.0 | 6/6 | Complete | 2026-02-06 |
| 6. Docker Deployment | v1.0 | 3/3 | Complete | 2026-02-06 |
| 7. CLI Support | v1.0 | 3/3 | Complete | 2026-02-06 |
| 8. Queue Mode | — | 3/3 | Complete | 2026-02-27 |

### Phase 8: Queue mode for requests when all providers exhausted

**Goal:** Add FIFO queue mode so requests wait for provider cooldowns instead of immediately failing with "All providers exhausted"
**Depends on:** v1.0 complete
**Plans:** 3/3 complete

Plans:
- [x] 08-01-PLAN.md — TDD RequestQueue class with types, errors, config schema
- [x] 08-02-PLAN.md — Wire queue into tracker, chat routes, ratelimits, index.ts, shutdown
- [x] 08-03-PLAN.md — Update config example and API documentation

---
*Roadmap created: 2026-02-05*
*Last updated: 2026-02-27 after phase 8 complete*
