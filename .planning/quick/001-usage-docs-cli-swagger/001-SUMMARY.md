---
phase: quick
plan: 001
subsystem: documentation
tags: [cli, api, swagger, reference, docker, authentication]

# Dependency graph
requires:
  - phase: 07-cli-support
    provides: CLI entry point with parseArgs, --init command, environment variable handling
  - phase: 04-observability
    provides: Stats endpoints, request logging, SQLite persistence
  - phase: 05-web-ui
    provides: Admin API for runtime config management
provides:
  - Comprehensive USAGE.md with CLI reference, config guide, and API documentation
  - Swagger-style API reference for all 14 endpoints with curl examples
  - Docker deployment guide with compose configuration
  - Authentication and error handling documentation
affects: [documentation, onboarding, api-clients]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Swagger-style API documentation with tables for parameters
    - Complete curl examples for every endpoint
    - Config schema documentation derived from Zod schemas

key-files:
  created:
    - docs/USAGE.md
  modified: []

key-decisions:
  - "Swagger-style formatting for API reference (tables for parameters, fenced code blocks for examples)"
  - "Single comprehensive USAGE.md file instead of separate guides"
  - "Include full config.example.yaml in documentation for reference"

patterns-established:
  - "API documentation format: method, path, auth, request/response schemas, curl example"
  - "CLI documentation format: flag table with short forms, types, defaults, descriptions"
  - "Config documentation derived directly from Zod schema definitions"

# Metrics
duration: 3min
completed: 2026-02-08
---

# Quick Task 001: Usage Documentation Summary

**Comprehensive 1436-line usage guide covering CLI, configuration, and complete API reference with curl examples for all 14 endpoints**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-07T19:51:08Z
- **Completed:** 2026-02-07T19:54:28Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Complete CLI reference with all flags (--config, --port, --init, --help) and usage examples
- Full configuration guide documenting every Zod schema field (settings, providers, chains, rate limits)
- Swagger-style API reference for all 14 endpoints with request/response schemas
- Working curl examples for every endpoint against localhost:3429
- Docker deployment guide with compose configuration and volume management
- Authentication, error handling, and waterfall mechanism documentation

## Task Commits

Each task was committed atomically:

1. **Task 1: Create docs/USAGE.md with full CLI and API reference** - `012eb32` (docs)

## Files Created/Modified
- `docs/USAGE.md` - Comprehensive usage guide (1436 lines) with 8 top-level sections: Quick Start, CLI Reference, Configuration, API Reference, Authentication, Docker Deployment, Error Handling, How Waterfall Works

## Decisions Made

**1. Single comprehensive file instead of separate guides**
- Created one USAGE.md instead of splitting into CLI.md, API.md, CONFIG.md
- Rationale: Easier to search/navigate, reduces documentation maintenance burden

**2. Swagger-style API documentation format**
- Used tables for parameters, fenced code blocks for request/response schemas
- Consistent structure: Auth → Request → Response → Example for every endpoint
- Rationale: Professional, scannable format familiar to API consumers

**3. Include full config.example.yaml in documentation**
- Embedded complete example config as reference
- Rationale: Users can see all options in context, understand structure at a glance

**4. Document dual purpose of `model` field**
- Explained that `model` field selects chain when it matches a chain name
- Otherwise uses defaultChain and passes model through to provider
- Rationale: This behavior is core to understanding chain selection

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Documentation complete and ready for:
- New user onboarding
- API client development
- Integration testing
- Package publishing (npm, Docker Hub)

All 14 API endpoints documented:
1. POST /v1/chat/completions (streaming and non-streaming)
2. GET /v1/models
3. GET /health
4. GET /v1/stats/providers
5. GET /v1/stats/providers/:providerId
6. GET /v1/stats/chains
7. GET /v1/stats/chains/:chainName
8. GET /v1/stats/requests
9. GET /v1/ratelimits
10. GET /v1/admin/config
11. PUT /v1/admin/providers/:id
12. DELETE /v1/admin/providers/:id
13. PUT /v1/admin/chains/:name
14. DELETE /v1/admin/chains/:name

---
*Phase: quick-001*
*Completed: 2026-02-08*
