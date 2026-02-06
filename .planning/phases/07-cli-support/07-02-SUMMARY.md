---
phase: 07-cli-support
plan: 02
subsystem: cli
tags: [esm, import.meta.url, cli, error-handling]

# Dependency graph
requires:
  - phase: 07-01
    provides: CLI entry point structure and --init command
provides:
  - import.meta.url-based static file path resolution for global installs
  - Graceful missing-config error with --init hint
affects: [deployment, user-experience]

# Tech tracking
tech-stack:
  added: []
  patterns: [import.meta.url + fileURLToPath for ESM path resolution, existsSync guard before file operations]

key-files:
  created: []
  modified: [src/index.ts, src/config/loader.ts, src/cli.ts]

key-decisions:
  - "Use import.meta.url + fileURLToPath + dirname + join for absolute path computation in ESM modules"
  - "Show user-friendly config-not-found error with console.error (not logger) before logger initialization"
  - "Process exits with code 1 when config missing instead of throwing ConfigError"

patterns-established:
  - "ESM path resolution: const __filename = fileURLToPath(import.meta.url); const __dirname = dirname(__filename); const path = join(__dirname, ...)"
  - "Graceful file-not-found handling: existsSync check before readFileSync with helpful error message"

# Metrics
duration: 4min
completed: 2026-02-06
---

# Phase 07 Plan 02: CLI Compatibility Summary

**import.meta.url-based static file serving and graceful config-not-found errors ensure 429chain works correctly when installed globally**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-06T05:18:36Z
- **Completed:** 2026-02-06T05:22:01Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Static UI assets now resolve relative to package installation location (not cwd)
- Missing config file shows helpful "run 429chain --init" message instead of raw ENOENT stack trace
- CLI runs correctly from any directory when globally installed

## Task Commits

Each task was committed atomically:

1. **Task 1: Update static file serving to use import.meta.url** - `3cd120f` (feat)
2. **Task 2: Add graceful missing-config handling with init hint** - `d0570a9` (feat)

**Plan metadata:** (pending)

## Files Created/Modified
- `src/index.ts` - Added import.meta.url path resolution for UI_DIST_PATH, updated all serveStatic calls to use absolute paths
- `src/config/loader.ts` - Added existsSync check with user-friendly error message before attempting readFileSync
- `src/cli.ts` - Fixed pre-existing type errors (typeof guards, import path)

## Decisions Made

**D060: import.meta.url for static file resolution**
- Use `import.meta.url + fileURLToPath + dirname + join` pattern for computing absolute paths in ESM modules
- Rationale: Relative paths like `./ui/dist` resolve from cwd, which breaks when globally installed. import.meta.url resolves relative to the module file location.
- Pattern: `const __dirname = dirname(fileURLToPath(import.meta.url)); const path = join(__dirname, '..', 'ui', 'dist');`

**D061: console.error for pre-logger errors**
- Use console.error (not logger) for config-not-found messages
- Rationale: Logger may not be initialized yet, and error must always be visible regardless of log level/format
- Process exits with code 1 after showing helpful message

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed CLI type errors for environment variable assignments**
- **Found during:** Task 1 (typecheck verification)
- **Issue:** values.config and values.port have type `string | true` (parseArgs returns true for boolean flags without values), but process.env requires `string | undefined`. TypeScript error: "Type 'string | true' is not assignable to type 'string | undefined'"
- **Fix:** Added typeof guards: `if (values.config && typeof values.config === 'string')` before assignment
- **Files modified:** src/cli.ts (lines 97-102)
- **Verification:** npm run typecheck passes
- **Committed in:** 3cd120f (Task 1 commit)

**2. [Rule 1 - Bug] Fixed CLI import path from index.mjs to index.js**
- **Found during:** Task 1 (typecheck verification)
- **Issue:** cli.ts imports './index.mjs' but TypeScript cannot find module declaration (build outputs .mjs but TypeScript needs .js import for module resolution)
- **Fix:** Changed `await import('./index.mjs')` to `await import('./index.js')` (TypeScript uses .js, bundler outputs .mjs at build time)
- **Files modified:** src/cli.ts (line 105)
- **Verification:** npm run typecheck passes, build succeeds
- **Committed in:** 3cd120f (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes necessary for type correctness. No scope creep.

## Issues Encountered
None - tasks executed as planned after fixing pre-existing type errors.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- CLI compatibility complete for global installation
- Static file serving works from any cwd
- Config errors are user-friendly with actionable guidance
- Ready for 07-03: package.json bin configuration and npm publishing preparation

---
*Phase: 07-cli-support*
*Completed: 2026-02-06*
