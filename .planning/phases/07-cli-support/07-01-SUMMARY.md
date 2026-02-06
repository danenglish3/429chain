---
phase: 07-cli-support
plan: 01
subsystem: cli
tags: [cli, npm, npx, node, shebang, parseArgs]

# Dependency graph
requires:
  - phase: 06-docker-deployment
    provides: Complete application with Docker packaging
provides:
  - CLI entry point with argument parsing and --init command
  - npm package configuration for CLI distribution
  - Line ending enforcement for cross-platform shebang compatibility
affects: [deployment, distribution, developer-experience]

# Tech tracking
tech-stack:
  added: [node:util parseArgs (built-in)]
  patterns: [shebang for CLI entry, import.meta.url for asset resolution, bin field for npm CLI packaging]

key-files:
  created:
    - src/cli.ts
    - .gitattributes
  modified:
    - package.json

key-decisions:
  - "Use parseArgs with strict:false to allow unknown args pass-through"
  - "Use import.meta.url for asset resolution in packaged CLI"
  - "Enforce LF line endings on dist/cli.mjs via .gitattributes for Windows compatibility"
  - "Split build into build:backend and build:ui for explicit control"
  - "Include config/config.example.yaml in npm package files whitelist"

patterns-established:
  - "CLI pattern: parseArgs → env vars → dynamic import of app bootstrap"
  - "Asset resolution: import.meta.url → fileURLToPath → dirname → join for package-relative paths"
  - "npm distribution: bin + files + prepublishOnly for safe publishing"

# Metrics
duration: 1.4min
completed: 2026-02-06
---

# Phase 7 Plan 1: CLI Infrastructure Summary

**CLI entry point with argument parsing, --init command for config setup, and npm package configuration for global install and npx usage**

## Performance

- **Duration:** 1.4 min
- **Started:** 2026-02-06T05:18:15Z
- **Completed:** 2026-02-06T05:19:38Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created CLI entry point with shebang, argument parsing for --config/--port/--init/--help
- Implemented --init command that copies config.example.yaml to user's working directory using import.meta.url for asset resolution
- Configured package.json for npm distribution with bin field, files whitelist, and split build scripts
- Added .gitattributes to enforce LF line endings on CLI entry point for cross-platform shebang compatibility

## Task Commits

Each task was committed atomically:

1. **Task 1: Create CLI entry point** - `5cac8bb` (feat)
2. **Task 2: Configure package.json for CLI distribution** - `01b847b` (chore)

## Files Created/Modified
- `src/cli.ts` - CLI entry point with shebang, parseArgs for --config/--port/--init/--help, init handler using import.meta.url, env var pass-through, and dynamic import of ./index.mjs
- `package.json` - Updated main to dist/index.mjs, added bin field for 429chain command, files whitelist (dist/, ui/dist/, config/config.example.yaml), split build scripts (build:backend + build:ui), prepublishOnly safety check, added 'cli' keyword
- `.gitattributes` - Enforces LF line endings on dist/cli.mjs to prevent CRLF shebang issues on Windows

## Decisions Made

**1. parseArgs with strict: false for arg pass-through**
- Allows unknown arguments to pass through without error
- Future-proofs CLI for additional flags without breaking existing behavior

**2. import.meta.url for asset resolution**
- Resolves config.example.yaml relative to the built CLI location
- Works correctly in both development (tsx) and production (packaged npm install)
- Pattern: import.meta.url → fileURLToPath → dirname → join

**3. LF enforcement via .gitattributes**
- Windows Git can convert line endings to CRLF, breaking shebang
- .gitattributes enforces LF on dist/cli.mjs regardless of platform
- Ensures `#!/usr/bin/env node` works on all systems

**4. Split build scripts**
- build:backend builds both src/cli.ts and src/index.ts to ESM
- build:ui builds frontend separately
- Main build script chains them together
- Explicit control over build order and outputs

**5. npm files whitelist**
- dist/ for backend code
- ui/dist/ for frontend assets
- config/config.example.yaml for --init command
- Prevents publishing dev artifacts (src/, tests/, etc.)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## Next Phase Readiness

**CLI infrastructure complete.** The 429chain package is now:
- Installable via npm install -g 429chain
- Runnable via npx 429chain
- Configurable via --config and --port flags
- Initializable via --init command

**Ready for:**
- Publishing to npm registry
- User distribution and installation
- Documentation updates with CLI usage examples

**Remaining work in Phase 7:**
- Documentation updates for CLI usage (if planned)
- Testing in actual npm install scenario (if planned)

---
*Phase: 07-cli-support*
*Completed: 2026-02-06*
