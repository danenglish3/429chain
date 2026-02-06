# Phase 7: CLI Support - Research

**Researched:** 2026-02-06
**Domain:** npm CLI packaging, ESM entry points, Node.js executable distribution
**Confidence:** HIGH

## Summary

Creating an npm-installable CLI tool from the existing 429chain application involves configuring the `bin` field in package.json to point to an executable entry point with a shebang, bundling static UI assets in the published package via the `files` field, and handling first-run configuration gracefully. The current stack (Node.js ESM, tsdown, better-sqlite3) is well-supported for CLI distribution.

**Key findings:**
- The `bin` field in package.json automatically creates executable symlinks on install, with npm handling permissions
- ESM modules work with shebangs when using `.mjs` extensions or `"type": "module"` in package.json
- tsdown already outputs `.mjs` files suitable for CLI entry points
- better-sqlite3 provides prebuilt binaries for Node.js LTS versions, working out-of-the-box with `npm install`
- The `files` field controls what gets published; must include `dist/` and `ui/dist/`
- Static file serving in packaged apps requires `import.meta.url` + `fileURLToPath()` to locate bundled assets
- Node.js built-in `util.parseArgs` is stable and sufficient for simple CLI arg parsing (--config, --port, --init)
- Modern CLI tools follow XDG Base Directory spec (~/.config) for user config, but project-local config (./config/config.yaml) is appropriate for 429chain's use case

**Primary recommendation:** Create a dedicated CLI entry point (`src/cli.ts`) that handles argument parsing and first-run initialization, then delegates to the existing application bootstrap. Use `util.parseArgs` for simplicity, include an `init` subcommand to scaffold config, and adjust static file paths to work with `import.meta.url`.

## Standard Stack

The established libraries/tools for Node.js CLI development:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `util.parseArgs` | Node.js 20+ | CLI argument parsing | Built-in, stable since v20.0.0, zero dependencies, sufficient for simple CLIs |
| `import.meta.url` | Node.js 20+ | Resolve package-relative paths | ESM standard for locating bundled assets in published packages |
| npm `bin` field | npm 7+ | Define CLI executables | Standard npm mechanism for creating global commands |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| chalk | 5.x | Terminal colors | If adding colored output (optional) |
| @inquirer/prompts | 8.x | Interactive prompts | If building interactive `init` wizard (optional for simple use) |
| commander | 12.x | Full-featured CLI framework | Only if need complex subcommands/middleware (overkill for 429chain) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| util.parseArgs | commander/yargs | More features (subcommands, middleware) but adds dependency weight; util.parseArgs sufficient for --config, --port, --init |
| Manual config copy | @inquirer/prompts | Interactive prompts are friendlier but add ~2MB dependency; simple file copy with instructions is lighter |

**Installation:**
```bash
# No additional dependencies needed - use built-in Node.js APIs
# Optional: if adding colors or interactive prompts
npm install chalk @inquirer/prompts
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── cli.ts              # NEW: CLI entry point with shebang, arg parsing
├── index.ts            # Existing app bootstrap (slightly modified)
├── config/
│   └── loader.ts       # Update to handle missing config gracefully
└── ...                 # Existing application code

dist/
├── cli.mjs             # Built CLI entry (from cli.ts)
├── index.mjs           # Built app bootstrap
└── ...

ui/dist/                # Vite build output (static assets)
├── index.html
└── assets/

config/
└── config.example.yaml # Example config to copy on init

package.json            # Updated with bin, files fields
```

### Pattern 1: CLI Entry Point with Shebang

**What:** A dedicated CLI entry script that handles argument parsing before bootstrapping the application

**When to use:** Always for CLI tools - separates CLI concerns from application logic

**Example:**
```typescript
#!/usr/bin/env node

// src/cli.ts
import { parseArgs } from 'node:util';
import { existsSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { values, positionals } = parseArgs({
  options: {
    config: {
      type: 'string',
      short: 'c',
      default: './config/config.yaml',
    },
    port: {
      type: 'string',
      short: 'p',
    },
    init: {
      type: 'boolean',
      description: 'Initialize config file',
    },
    help: {
      type: 'boolean',
      short: 'h',
    },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(`
Usage: 429chain [options]

Options:
  -c, --config <path>   Config file path (default: ./config/config.yaml)
  -p, --port <port>     Override server port
  --init                Create example config file
  -h, --help            Show this help
  `);
  process.exit(0);
}

if (values.init) {
  // Handle init command
  const targetPath = values.config || './config/config.yaml';
  // Copy example config (from package location, not cwd)
  const examplePath = new URL('../config/config.example.yaml', import.meta.url);
  // ... implementation
  process.exit(0);
}

// Set environment variables for existing app
if (values.config) {
  process.env.CONFIG_PATH = values.config;
}
if (values.port) {
  process.env.PORT = values.port;
}

// Bootstrap existing application
await import('./index.js');
```

**Source:** [Node.js ESM documentation](https://nodejs.org/api/esm.html), [util.parseArgs documentation](https://nodejs.org/api/util.html#utilparseargsconfig)

### Pattern 2: Locating Bundled Assets with import.meta.url

**What:** Use `import.meta.url` to resolve paths relative to the installed package, not the user's cwd

**When to use:** When serving static files or copying bundled assets in a published npm package

**Example:**
```typescript
// src/index.ts - Update static file serving
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';

// Get package directory, not process.cwd()
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const UI_DIST = join(__dirname, '../ui/dist');

// Serve static assets from package location
app.use('/assets/*', serveStatic({ root: UI_DIST }));
app.use('/vite.svg', serveStatic({ path: join(UI_DIST, 'vite.svg') }));
app.get('*', async (c, next) => {
  if (c.req.path.startsWith('/v1/') || c.req.path.startsWith('/health')) {
    return next();
  }
  return serveStatic({ path: join(UI_DIST, 'index.html') })(c, next);
});
```

**Why:** Current code uses `./ui/dist` which is relative to `process.cwd()`. When installed as a global npm package, `cwd` is the user's directory, not the package installation. `import.meta.url` resolves to the actual file location in `node_modules` or global install directory.

**Source:** [Node.js ESM import.meta.url](https://nodejs.org/api/esm.html#importmetaurl), [Hono serve-static discussion](https://github.com/honojs/hono/issues/2565)

### Pattern 3: Graceful Config Handling

**What:** Detect missing config file and provide helpful message instead of crashing

**When to use:** First-run experience for CLI tools that require configuration

**Example:**
```typescript
// src/config/loader.ts - Update loadConfig
export function loadConfig(path: string): Config {
  if (!existsSync(path)) {
    logger.error({ configPath: path }, 'Config file not found');
    console.error(`
ERROR: Config file not found at ${path}

To initialize a new config file, run:
  429chain --init

Or specify a different config location:
  429chain --config /path/to/config.yaml
    `);
    process.exit(1);
  }

  // ... existing load logic
}
```

**Source:** [Node.js CLI Apps Best Practices](https://github.com/lirantal/nodejs-cli-apps-best-practices)

### Pattern 4: package.json Configuration

**What:** Configure `bin`, `files`, and build scripts for CLI distribution

**When to use:** Always for npm CLI packages

**Example:**
```json
{
  "name": "429chain",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.mjs",
  "bin": {
    "429chain": "dist/cli.mjs"
  },
  "files": [
    "dist/",
    "ui/dist/",
    "config/config.example.yaml",
    "README.md"
  ],
  "scripts": {
    "build": "npm run build:backend && npm run build:ui",
    "build:backend": "tsdown src/cli.ts src/index.ts --format esm --dts",
    "build:ui": "cd ui && npm run build",
    "prepublishOnly": "npm run build"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

**Why:**
- `bin` creates executable symlink `429chain` → `dist/cli.mjs` on install
- `files` whitelist ensures only necessary files are published (reduces package size)
- `prepublishOnly` ensures builds run before `npm publish` (not `npm install`)
- tsdown builds both `cli.ts` and `index.ts` as separate entry points

**Source:** [npm package.json documentation](https://docs.npmjs.com/cli/v10/configuring-npm/package-json), [npm scripts documentation](https://docs.npmjs.com/cli/v6/using-npm/scripts/)

### Anti-Patterns to Avoid

- **Using `./ui/dist` hardcoded paths in serve-static** - Breaks when installed globally; use `import.meta.url` + `fileURLToPath()`
- **Crash on missing config without helpful message** - User doesn't know what to do; show init command
- **Adding `preferGlobal: true` to package.json** - Deprecated field, modern approach is to support both `npm install -g` and `npx` equally
- **Using `process.cwd()` to locate package assets** - cwd is user's directory, not package location
- **Forgetting `prepublishOnly` script** - Might publish unbuild code if you forget to manually run build
- **Not including ui/dist in `files` field** - Static assets won't be published, app serves 404s

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CLI argument parsing | Manual `process.argv` parsing | `util.parseArgs` (built-in) | Handles `--flag`, `-f`, values, validation; built-in Node.js since v20 |
| Locating package root | `process.cwd()` assumptions | `import.meta.url` + `fileURLToPath()` | cwd is user's directory; import.meta.url is file's actual location |
| Config file copying | String manipulation + fs | `new URL('../relative/path', import.meta.url)` | Correctly resolves paths within published package |
| Executable permissions | Manual `chmod +x` | npm `bin` field | npm automatically sets execute bit on install |
| Version display | Hardcoded strings | `import pkg from './package.json' with { type: 'json' }` | Single source of truth (requires Node 22.6+, or use `readFile + JSON.parse`) |

**Key insight:** npm and Node.js ESM provide robust primitives for CLI distribution. Don't reinvent path resolution, argument parsing, or file permissions.

## Common Pitfalls

### Pitfall 1: Relative Paths Break in Published Packages

**What goes wrong:** Using `./ui/dist` works during development but fails when package is installed globally or in `node_modules`

**Why it happens:** `process.cwd()` returns the user's current directory, not the package installation directory. During development, cwd happens to be the project root, hiding the issue.

**How to avoid:**
- Always use `import.meta.url` + `fileURLToPath()` + `dirname()` to get package location
- Test by actually installing package globally (`npm link` locally, or `npm install -g .`)

**Warning signs:**
- Static files work in dev (`npm run dev`) but fail after `npm install -g`
- 404 errors on `/assets/*` routes when running as CLI
- "ENOENT: no such file or directory, open './ui/dist/index.html'"

### Pitfall 2: Forgetting to Build UI Before Publishing

**What goes wrong:** Backend builds fine with `npm run build`, but `ui/dist/` is empty or stale, causing 404s in published package

**Why it happens:** The `build` script only builds backend; UI build is separate and easy to forget

**How to avoid:**
- Create combined `build` script: `"build": "npm run build:backend && npm run build:ui"`
- Add `prepublishOnly` hook to run build automatically before publish
- Verify `files` field includes `ui/dist/`

**Warning signs:**
- Package size is suspiciously small (no UI assets)
- Published package shows old UI or blank pages
- `npm pack` produces small tarball

### Pitfall 3: better-sqlite3 Native Module Compatibility

**What goes wrong:** Package installs fine on your machine but fails on user's machine with "node version mismatch" or "could not find native module"

**Why it happens:** better-sqlite3 includes native binaries compiled for specific Node.js versions. Users on non-LTS versions may need to compile from source.

**How to avoid:**
- Document Node.js version requirement clearly: `"engines": { "node": ">=20.0.0" }` (LTS)
- better-sqlite3 provides prebuilt binaries for LTS - users on LTS should have zero issues
- For bleeding-edge users: document that they may need build tools (python, make, g++)

**Warning signs:**
- Users report installation failures on non-LTS Node versions (e.g., odd-numbered 21.x)
- "Error: Cannot find module '...better-sqlite3.node'"

### Pitfall 4: Shebang Encoding Issues

**What goes wrong:** CLI fails to execute with "bad interpreter" error on Unix systems

**Why it happens:** Wrong line endings (CRLF instead of LF) or BOM in file with shebang

**How to avoid:**
- Ensure CLI entry file uses LF line endings (`.gitattributes`: `dist/cli.mjs text eol=lf`)
- tsdown preserves shebangs - verify in build output
- Test on both Windows and Unix-like systems

**Warning signs:**
- "bad interpreter: /usr/bin/env: no such file or directory"
- "#!/usr/bin/env node^M: not found"

### Pitfall 5: Config Resolution Order Confusion

**What goes wrong:** Users pass `--config` but app still loads default config, or env var `CONFIG_PATH` is ignored

**Why it happens:** Config resolution order not clearly defined or implemented inconsistently

**How to avoid:**
- Document and implement consistent priority: CLI args > env vars > default
- Update `resolveConfigPath()` to check CLI args first (already does this)
- Test all three resolution paths

**Warning signs:**
- Users report `--config` flag doesn't work
- Environment variables silently ignored

## Code Examples

Verified patterns for CLI implementation:

### Creating CLI Entry Point

```typescript
#!/usr/bin/env node

/**
 * CLI entry point for 429chain.
 * Handles argument parsing, help text, init command, then bootstraps app.
 */

import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// Parse command-line arguments
const { values } = parseArgs({
  options: {
    config: { type: 'string', short: 'c' },
    port: { type: 'string', short: 'p' },
    init: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: false, // Allow unknown args to pass through
});

// Show help
if (values.help) {
  console.log(`
429chain - OpenAI-compatible proxy with rate limit handling

Usage: 429chain [options]

Options:
  -c, --config <path>   Config file path (default: ./config/config.yaml)
  -p, --port <port>     Override server port
  --init                Create example config file in current directory
  -h, --help            Show this help message

Examples:
  429chain                              # Start with default config
  429chain --config /etc/429chain.yaml  # Use custom config
  429chain --init                       # Create example config
  npx 429chain                          # Run without installing
  `);
  process.exit(0);
}

// Handle init command
if (values.init) {
  const targetDir = resolve(process.cwd(), 'config');
  const targetPath = join(targetDir, 'config.yaml');

  // Get example config from package location
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const examplePath = join(__dirname, '../config/config.example.yaml');

  if (existsSync(targetPath)) {
    console.error(`Config file already exists at ${targetPath}`);
    console.log('To reinitialize, delete the existing file first.');
    process.exit(1);
  }

  mkdirSync(targetDir, { recursive: true });
  copyFileSync(examplePath, targetPath);

  console.log(`Created config file at ${targetPath}`);
  console.log('\nNext steps:');
  console.log('1. Edit config/config.yaml with your provider credentials');
  console.log('2. Run: 429chain');
  process.exit(0);
}

// Set environment variables for app
if (values.config) {
  process.env.CONFIG_PATH = values.config;
}
if (values.port) {
  process.env.PORT = values.port;
}

// Bootstrap main application
await import('./index.mjs');
```

**Source:** [util.parseArgs documentation](https://nodejs.org/api/util.html#utilparseargsconfig)

### Updating Static File Serving

```typescript
// src/index.ts - Update to use import.meta.url for packaged assets

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';

// Get package installation directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve UI assets relative to package, not cwd
const UI_DIST_PATH = join(__dirname, '../ui/dist');

// Update static file serving
app.use('/assets/*', serveStatic({ root: UI_DIST_PATH }));
app.use('/vite.svg', serveStatic({ path: join(UI_DIST_PATH, 'vite.svg') }));

// SPA fallback
app.get('*', async (c, next) => {
  if (c.req.path.startsWith('/v1/') || c.req.path.startsWith('/health')) {
    return next();
  }
  return serveStatic({ path: join(UI_DIST_PATH, 'index.html') })(c, next);
});
```

**Source:** [Node.js ESM import.meta.url](https://nodejs.org/api/esm.html#importmetaurl), [Alternatives to __dirname in Node.js ES modules](https://blog.logrocket.com/alternatives-dirname-node-js-es-modules/)

### Updated package.json for CLI Distribution

```json
{
  "name": "429chain",
  "version": "0.1.0",
  "type": "module",
  "description": "OpenAI-compatible proxy that waterfalls requests through provider chains on rate limits",
  "main": "dist/index.mjs",
  "bin": {
    "429chain": "dist/cli.mjs"
  },
  "files": [
    "dist/",
    "ui/dist/",
    "config/config.example.yaml",
    "README.md",
    "LICENSE"
  ],
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "npm run build:backend && npm run build:ui",
    "build:backend": "tsdown src/cli.ts src/index.ts --format esm --dts",
    "build:ui": "cd ui && npm run build",
    "start": "node dist/index.mjs",
    "prepublishOnly": "npm test && npm run build"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "keywords": [
    "openai",
    "proxy",
    "rate-limit",
    "waterfall",
    "llm",
    "cli"
  ]
}
```

**Why each field:**
- `bin`: Creates global command `429chain` that runs `dist/cli.mjs`
- `files`: Whitelist what gets published (default is everything, which is wasteful)
- `build:backend`: tsdown builds both entry points (`cli.ts` and `index.ts`)
- `prepublishOnly`: Runs tests + build before `npm publish`, prevents publishing broken code
- `engines`: Documents Node.js version requirement (critical for better-sqlite3 prebuilts)

**Source:** [npm package.json documentation](https://docs.npmjs.com/cli/v10/configuring-npm/package-json)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `__dirname` variable | `import.meta.url` + `fileURLToPath()` | Node.js 12.20+ (ESM stable) | ESM doesn't provide `__dirname`; must derive from `import.meta.url` |
| `prepublish` script | `prepublishOnly` or `prepare` | npm 4.0.0 (2017) | `prepublish` ran on install too; `prepublishOnly` only on publish |
| commander/yargs required | `util.parseArgs` built-in | Node.js 18.3.0 (stable v20+) | Zero-dependency CLI parsing now available; still experimental in 18.x |
| `require('./package.json')` | `import pkg from './package.json' with { type: 'json' }` | Node.js 22.6+ | Import attributes for JSON; older: use `readFileSync + JSON.parse` |
| Manual `chmod +x` | npm `bin` field auto-handles | npm 1.0+ (always worked) | Developers sometimes don't realize npm handles this |

**Deprecated/outdated:**
- `preferGlobal: true` in package.json: Deprecated, npm no longer warns if missing; ecosystem shifted to npx
- `prepublish` script: Confusing behavior (ran on install); use `prepublishOnly` or `prepare`
- Hardcoded relative paths (`./ui/dist`): Breaks in published packages; use `import.meta.url`

## Open Questions

Things that couldn't be fully resolved:

1. **Should 429chain CLI support XDG Base Directory (~/.config/429chain/) for user config?**
   - What we know: Many modern CLI tools follow XDG spec for user-level config
   - What's unclear: 429chain's config is project/deployment-specific (API keys, provider chains), not user-preference config
   - Recommendation: Keep current approach (project-local `./config/config.yaml`, configurable via `--config` and `CONFIG_PATH`). XDG is for user preferences (themes, aliases), not deployment configs. Users deploying multiple instances want separate configs per instance.

2. **Should package include a "getting started" check or validation on first run?**
   - What we know: Some CLIs check for valid config on startup and show setup wizard
   - What's unclear: How much hand-holding is appropriate for a developer tool
   - Recommendation: Keep it simple - fail fast with helpful error message pointing to `--init`. Developers prefer explicit commands over automatic wizards.

3. **Should the package pre-build UI assets, or build them in prepublishOnly?**
   - What we know: `prepublishOnly` ensures fresh build before publish
   - What's unclear: Whether to commit `ui/dist/` to git for simpler CI/Docker builds
   - Recommendation: Don't commit build artifacts to git. Use `prepublishOnly` for npm, keep separate Docker build that builds both. Committed builds get stale and create merge conflicts.

## Sources

### Primary (HIGH confidence)

- [Node.js util.parseArgs documentation](https://nodejs.org/api/util.html#utilparseargsconfig) - Official Node.js API docs for built-in CLI parsing
- [Node.js ESM documentation](https://nodejs.org/api/esm.html) - Official docs on import.meta.url, ESM executables, import.meta.main
- [npm package.json documentation](https://docs.npmjs.com/cli/v10/configuring-npm/package-json) - Official npm docs on bin, files, scripts fields
- [better-sqlite3 GitHub README](https://github.com/WiseLibs/better-sqlite3) - Confirms prebuilt binaries for LTS Node.js versions
- [tsdown documentation](https://tsdown.dev/reference/cli) - Official tsdown CLI and build config documentation

### Secondary (MEDIUM confidence)

- [Node.js CLI Apps Best Practices](https://github.com/lirantal/nodejs-cli-apps-best-practices) - Community-maintained CLI best practices guide
- [Creating ESM-based shell scripts for Unix and Windows with Node.js](https://2ality.com/2022/07/nodejs-esm-shell-scripts.html) - Dr. Axel Rauschmayer's guide on ESM shebangs
- [Alternatives to __dirname in Node.js with ES modules](https://blog.logrocket.com/alternatives-dirname-node-js-es-modules/) - Tutorial on import.meta.url patterns
- [npm scripts documentation](https://docs.npmjs.com/cli/v6/using-npm/scripts/) - Official npm scripts reference
- [Command-line argument parsing with Node.js core](https://simonplend.com/command-line-argument-parsing-with-node-js-core/) - Tutorial on util.parseArgs

### Tertiary (LOW confidence - general ecosystem info)

- [How to use npx: the npm package runner](https://blog.scottlogic.com/2018/04/05/npx-the-npm-package-runner.html) - General npx usage patterns
- [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir/latest/) - Standard for config file locations
- [Hono serve-static discussion](https://github.com/honojs/hono/issues/2565) - Community discussion on static file serving
- Multiple npm-compare.com comparisons (commander vs yargs, inquirer alternatives) - Feature comparisons

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - util.parseArgs is stable Node.js built-in, bin field is decades-old npm standard, better-sqlite3 prebuilts documented
- Architecture: HIGH - import.meta.url is ESM standard, bin configuration well-documented, patterns verified in Node.js docs
- Pitfalls: MEDIUM-HIGH - Based on common CLI packaging issues (relative paths, build artifacts), verified through community discussions and official docs

**Research date:** 2026-02-06
**Valid until:** 2026-05-06 (90 days - Node.js/npm are stable, util.parseArgs API unlikely to change)
