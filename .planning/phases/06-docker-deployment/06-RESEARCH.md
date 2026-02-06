# Phase 6: Docker Deployment - Research

**Researched:** 2026-02-06
**Domain:** Docker containerization for Node.js/TypeScript ESM applications with native dependencies
**Confidence:** HIGH

## Summary

Docker deployment for Node.js applications in 2026 centers on multi-stage builds as the standard pattern, with build optimization and security as primary concerns. For this project, the key challenges are: (1) building better-sqlite3 native modules correctly in containers, (2) persisting SQLite database files with WAL mode support, and (3) serving both the API and Vite-built static files from a single container.

The standard approach uses a three-stage Dockerfile: dependencies stage, build stage, and minimal production runtime stage. This pattern reduces final image size by 70%+ while maintaining build cache efficiency. For native modules like better-sqlite3, Debian-based images (node:20-slim) are more reliable than Alpine despite being ~70MB larger, because Alpine's musl libc causes compatibility issues with native C++ bindings.

Volume mounts follow a clear pattern: named volumes for database persistence (Docker-managed), and optional bind mounts for config files in development. Health checks integrate with the existing /health endpoint using Docker's built-in healthcheck mechanism. Environment variables are managed through .env files separate from docker-compose.yaml for security.

**Primary recommendation:** Use multi-stage Dockerfile with node:20-slim base, named volumes for SQLite data directory, bind mount for config file, and built-in Docker health checks pointing to /health endpoint.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Docker | 1.13+ | Container runtime | Built-in init support (tini), multi-stage builds |
| Docker Compose | 2.24+ | Multi-container orchestration | Optional .env files, healthcheck dependencies |
| Node.js (Debian Slim) | 20-slim | Production base image | Best compatibility with native modules, includes node user |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tini | Built-in | Init system (PID 1) | Always for Node.js containers (use --init flag) |
| curl | Included in slim | HTTP health checks | Testing /health endpoint in HEALTHCHECK |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| node:20-slim | node:20-alpine | Alpine 30% smaller (~150MB vs ~220MB) but causes better-sqlite3 build issues, 15% slower performance, experimental Node.js support |
| Named volumes | Bind mounts | Bind mounts better for development (live config edits) but less portable, harder to backup |
| Built-in healthcheck | External monitoring | External monitoring more sophisticated but requires additional infrastructure |

**Installation:**
```bash
# No npm packages needed - Docker and Docker Compose are system tools
# Verify versions:
docker --version  # Should be 1.13+
docker compose version  # Should be 2.24+
```

## Architecture Patterns

### Recommended Project Structure
```
/
├── Dockerfile                # Multi-stage build definition
├── docker-compose.yml        # Service orchestration
├── .dockerignore            # Build context exclusions
├── .env.example             # Template for environment variables
├── config/
│   └── config.example.yaml  # Template for production config
└── data/                    # Created by Docker, gitignored
    └── observability.db     # SQLite database (volume mount target)
```

### Pattern 1: Multi-Stage Dockerfile for TypeScript/ESM
**What:** Separate stages for dependencies, building, and production runtime
**When to use:** Any TypeScript project with build step and native dependencies
**Example:**
```dockerfile
# Stage 1: Install dependencies only
FROM node:20-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Stage 2: Build TypeScript to JavaScript
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 3: Build UI
FROM node:20-slim AS ui-builder
WORKDIR /app/ui
COPY ui/package*.json ./
RUN npm ci
COPY ui/ ./
RUN npm run build

# Stage 4: Production runtime
FROM node:20-slim
WORKDIR /app

# Security: run as non-root
USER node

# Copy production dependencies
COPY --from=deps --chown=node:node /app/node_modules ./node_modules

# Copy built artifacts
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=ui-builder --chown=node:node /app/ui/dist ./ui/dist
COPY --chown=node:node package*.json ./

# Expose port
EXPOSE 3429

# Health check using built-in endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3429/health || exit 1

# Use tini as init system (handles PID 1)
ENTRYPOINT ["/usr/bin/docker-init", "--"]

CMD ["node", "dist/index.js"]
```

### Pattern 2: Docker Compose with Named Volumes and Health Checks
**What:** Service definition with volume persistence and dependency management
**When to use:** Production deployment and local development with docker compose
**Example:**
```yaml
# Source: Official Docker Compose documentation
version: '3.8'

services:
  proxy:
    build: .
    init: true  # Enable tini for PID 1 signal handling
    ports:
      - "3429:3429"
    volumes:
      # Named volume for database (Docker-managed)
      - data:/app/data
      # Bind mount for config (user-supplied)
      - ./config/config.yaml:/app/config/config.yaml:ro
    environment:
      - NODE_ENV=production
      - CONFIG_PATH=/app/config/config.yaml
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3429/health"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 10s
    restart: unless-stopped

volumes:
  data:
    driver: local
```

### Pattern 3: .dockerignore for Build Optimization
**What:** Exclude files from Docker build context to speed up builds and reduce image size
**When to use:** Always - create before first docker build
**Example:**
```dockerignore
# Source: Docker best practices
node_modules
npm-debug.log*
dist
build
.git
.github
*.md
!README.md
.env*
!.env.example
.vscode
.idea
*.log
coverage
.cache
.planning
ui/node_modules
ui/dist
**/*.test.ts
**/*.spec.ts
*.sqlite
*.db
*.db-shm
*.db-wal
```

### Anti-Patterns to Avoid
- **Running as root:** Node.js processes should use the `node` user (UID 1000) for security. Never omit USER directive.
- **Using npm to start app:** `CMD ["npm", "start"]` absorbs signals; use `CMD ["node", "dist/index.js"]` directly.
- **Copying node_modules from host:** Always run `npm ci` inside container to build native modules for target architecture.
- **Single Dockerfile for dev and prod:** Development needs differ from production; use multi-stage builds and separate compose files.
- **Hardcoded UIDs in volumes:** Let Docker manage permissions via named volumes; avoid chown in entrypoint scripts.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Init system for PID 1 | Custom signal handler | Docker --init flag or tini | Node.js doesn't handle SIGINT/SIGTERM as PID 1; init systems properly forward signals and reap zombies |
| Build caching | Custom layer ordering | npm ci with split COPY | Docker layer caching works automatically when package.json copied separately from source |
| Health monitoring | Custom /ping endpoint | Use existing /health with HEALTHCHECK | Docker orchestrators (Swarm, Kubernetes) read HEALTHCHECK; no need for separate endpoint |
| Database backup | Custom backup script | Docker volume backup tools | `docker run --rm --volumes-from <container> -v $(pwd):/backup busybox tar cvf /backup/backup.tar /app/data` |
| Secrets management | Environment variables | Docker secrets (Swarm) or external vaults | Build args and ENV vars leak in image history; secrets are encrypted at rest |

**Key insight:** Docker has mature tooling for all container lifecycle operations. Custom solutions add maintenance burden without improving functionality.

## Common Pitfalls

### Pitfall 1: better-sqlite3 Build Failures in Alpine
**What goes wrong:** Dockerfile builds succeed but runtime crashes with "Exec format error" or missing symbols (fcntl64) when using Alpine base images.
**Why it happens:** better-sqlite3 compiles native C++ code. Alpine uses musl libc instead of glibc, causing binary incompatibility. Copying node_modules from host to Alpine container fails because architectures differ.
**How to avoid:** Use node:20-slim (Debian-based) instead of node:20-alpine. If Alpine is required, install build dependencies (python3, make, g++, libsqlite3-dev) and run npm ci inside Dockerfile.
**Warning signs:** Error messages mentioning "musl", "fcntl64", "symbol not found", or "Exec format error" during npm install or runtime.

### Pitfall 2: SQLite WAL Files Not Persisting or Corrupting
**What goes wrong:** After container restart, database appears empty, queries fail, or WAL mode doesn't work properly. Multiple containers experience lock contention.
**Why it happens:** SQLite creates three files: .db, .db-shm (shared memory), .db-wal (write-ahead log). If volume mount points to the file instead of directory, or if multiple containers share volume without shared kernel, WAL mode breaks. WAL doesn't work on network filesystems or across VM boundaries.
**How to avoid:** Mount the entire data directory, not individual .db file: `- data:/app/data` (not `- data:/app/data/observability.db`). Use named volumes (local driver) for single-host deployments. For multi-host, switch to PostgreSQL or mount on shared kernel (not NFS).
**Warning signs:** "database is locked" errors, missing data after restarts, .db-wal file not created, or PRAGMA journal_mode returns DELETE instead of WAL.

### Pitfall 3: Node.js Process Doesn't Respond to docker stop
**What goes wrong:** `docker stop` takes 10 seconds (default timeout) and forcefully kills container instead of graceful shutdown. Logs show incomplete shutdown sequence.
**Why it happens:** Node.js as PID 1 doesn't receive or properly handle SIGTERM. Without init system, signals don't propagate correctly. Using `npm start` creates npm as PID 1, which doesn't forward signals to Node.js.
**How to avoid:** Use `init: true` in docker-compose.yml or `--init` flag with docker run. Use `CMD ["node", "dist/index.js"]` directly, not `CMD ["npm", "start"]`. Implement graceful shutdown handlers (SIGTERM, SIGINT) in application code.
**Warning signs:** Container takes full timeout to stop, "received signal" logs missing, database connections not closing cleanly, or "Killed" messages in logs.

### Pitfall 4: Build Cache Invalidation on Every Code Change
**What goes wrong:** Even small code changes trigger full `npm install`, making builds take 2-3 minutes instead of 10 seconds.
**Why it happens:** Copying all files before npm install means any file change invalidates npm cache layer. Docker rebuilds all subsequent layers. Common mistake: `COPY . .` before `RUN npm ci`.
**How to avoid:** Copy package files separately first: `COPY package*.json ./` then `RUN npm ci`, then `COPY . .` for source code. Use .dockerignore to exclude volatile files (logs, .env, .git). Consider build cache mounts: `RUN --mount=type=cache,target=/root/.npm npm ci`.
**Warning signs:** Docker output shows "npm install" step running on every build, even when dependencies haven't changed. Build times consistently high.

### Pitfall 5: Environment Variables Exposing Secrets
**What goes wrong:** API keys and secrets leaked in Docker image history or visible in `docker inspect`. Production secrets committed to git in .env files.
**Why it happens:** ENV and ARG instructions are stored in image layers permanently. .env files often committed with real values. Build args passed on command line appear in `docker history`.
**How to avoid:** Use .env.example in git with placeholder values. Require real .env at runtime (not build time). For Docker Swarm, use `docker secret`. For Kubernetes, use Secrets. Set `required: false` in docker-compose.yml env_file to allow missing .env in CI. Document which variables are required.
**Warning signs:** `docker history <image>` shows sensitive values, .env in git history, or secrets visible in CI logs.

### Pitfall 6: Missing Health Check Causes Routing to Unhealthy Containers
**What goes wrong:** Load balancer routes traffic to container still initializing or failing internally. Database migration errors or config validation errors go unnoticed.
**Why it happens:** Without HEALTHCHECK, Docker considers container healthy as soon as process starts. Application may take 5-10 seconds to initialize (database migrations, config loading). If /health endpoint not implemented or returns 200 during initialization, checks pass prematurely.
**How to avoid:** Implement /health endpoint that validates: database connection, config loaded, critical dependencies ready. Add `start_period: 10s` to allow initialization before checks count toward health. Set appropriate timeout and retries. Test with `docker compose ps` to verify health status.
**Warning signs:** "Connection refused" errors immediately after deploy, requests failing during rolling updates, or orchestrator logs showing container restarts.

### Pitfall 7: File Permission Errors with Named Volumes
**What goes wrong:** Application can't write to /app/data directory. "EACCES: permission denied" when creating observability.db. Works locally but fails in Docker.
**Why it happens:** WORKDIR created as root, then USER node switches to uid 1000. node user can't write to root-owned directories. Volume mounts preserve ownership - if host directory mounted, host ownership may mismatch container user.
**How to avoid:** For named volumes (recommended), ensure WORKDIR and data directory created before USER directive, or use `COPY --chown=node:node`. For bind mounts, document that user should `mkdir data && chown 1000:1000 data` before first run, or use entrypoint script to chown at runtime (less secure).
**Warning signs:** EACCES errors on file operations, sqlite "unable to open database file", or directory listing shows root:root ownership for directories node needs to write.

## Code Examples

Verified patterns from official sources:

### Complete Multi-Stage Dockerfile for ESM TypeScript + Native Modules
```dockerfile
# Source: Node.js Docker best practices and Better Stack Docker guide
# https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md
# https://betterstack.com/community/guides/scaling-nodejs/dockerize-nodejs/

# Stage 1: Dependencies (production only)
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Use npm ci for reproducible builds
RUN npm ci --only=production && npm cache clean --force

# Stage 2: Build application
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
# Install all dependencies (including devDependencies for build)
RUN npm ci
# Copy source code
COPY tsconfig.json ./
COPY src ./src
# Build TypeScript to JavaScript
RUN npm run build

# Stage 3: Build UI
FROM node:20-slim AS ui-builder
WORKDIR /app/ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui/ ./
# Vite build outputs to ui/dist
RUN npm run build

# Stage 4: Production runtime
FROM node:20-slim
WORKDIR /app

# Install curl for health checks
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Create data directory with correct ownership before switching users
RUN mkdir -p /app/data && chown -R node:node /app

# Switch to non-root user
USER node

# Copy only production dependencies from deps stage
COPY --from=deps --chown=node:node /app/node_modules ./node_modules

# Copy built JavaScript from builder stage
COPY --from=builder --chown=node:node /app/dist ./dist

# Copy built UI from ui-builder stage
COPY --from=ui-builder --chown=node:node /app/ui/dist ./ui/dist

# Copy package.json for metadata
COPY --chown=node:node package.json ./

# Expose port (must match settings.port in config)
EXPOSE 3429

# Set production environment
ENV NODE_ENV=production

# Health check using /health endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3429/health || exit 1

# Use node directly (not npm) to receive signals properly
# Note: docker-init handled by compose `init: true` or docker run --init
CMD ["node", "dist/index.js"]
```

### Production docker-compose.yml with Health Checks and Volumes
```yaml
# Source: Docker Compose official documentation
# https://docs.docker.com/compose/how-tos/environment-variables/
# https://docs.docker.com/reference/compose-file/services/

version: '3.8'

services:
  proxy:
    build:
      context: .
      dockerfile: Dockerfile
    image: 429chain:latest
    container_name: 429chain-proxy
    init: true  # Enable tini init system for proper PID 1 handling
    ports:
      - "3429:3429"
    volumes:
      # Named volume for database persistence (Docker-managed)
      - data:/app/data
      # Bind mount for config (read-only)
      - ./config/config.yaml:/app/config/config.yaml:ro
    environment:
      - NODE_ENV=production
      # Config path pointing to mounted file
      - CONFIG_PATH=/app/config/config.yaml
    env_file:
      # Optional .env file for environment-specific overrides
      - path: ./.env
        required: false
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3429/health"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 10s
    restart: unless-stopped
    # Resource limits for production
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M

volumes:
  # Named volume for SQLite database
  # Use local driver for single-host deployment
  data:
    driver: local
```

### Comprehensive .dockerignore
```dockerignore
# Source: Docker best practices and Node.js recommendations
# https://snyk.io/blog/10-best-practices-to-containerize-nodejs-web-applications-with-docker/

# Dependencies (installed in container)
node_modules
ui/node_modules
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Build outputs (created in container)
dist
build
ui/dist
ui/build
*.tsbuildinfo

# Git and version control
.git
.gitignore
.gitattributes
.github

# Development and IDE
.vscode
.idea
*.swp
*.swo
*~
.DS_Store
.env.local
.env.development

# Testing
coverage
.nyc_output
**/*.test.ts
**/*.spec.ts
**/__tests__
**/__mocks__

# Documentation (not needed in runtime)
*.md
!README.md
docs
.planning

# CI/CD
.gitlab-ci.yml
.travis.yml
Jenkinsfile

# Environment files (provide at runtime)
.env
.env.*
!.env.example

# Database files (mounted as volumes)
*.db
*.sqlite
*.db-wal
*.db-shm
data/

# Logs (use stdout/stderr in containers)
logs
*.log
```

### Example .env.example for Documentation
```bash
# Source: Docker Compose environment variables best practices
# https://docs.docker.com/compose/how-tos/environment-variables/best-practices/

# Node environment (production|development)
NODE_ENV=production

# Config file path (should match volume mount)
CONFIG_PATH=/app/config/config.yaml

# Database path (should be in mounted volume)
DB_PATH=/app/data/observability.db

# Optional: Override settings from config.yaml
# PORT=3429
# LOG_LEVEL=info
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single FROM | Multi-stage builds | Docker 17.05 (2017) | 70%+ image size reduction standard practice |
| Manual init systems | Built-in tini (--init) | Docker 1.13 (2017) | No need to install tini; built into Docker |
| Alpine for everything | Debian-slim for native modules | ~2020 (better-sqlite3 issues) | Trade 70MB for reliability with C++ bindings |
| docker-compose v1 | docker-compose v2 (plugin) | 2021 | `docker compose` (not `docker-compose`), better integration |
| start_period only | start_interval for fast checks | Docker Compose 2.20.2 (2023) | More responsive health checks during startup |
| ENV for secrets | Docker secrets / external vaults | Ongoing | ENV still common but discouraged for sensitive data |

**Deprecated/outdated:**
- **docker-compose (standalone):** Use `docker compose` (plugin) instead. Standalone version deprecated.
- **MAINTAINER instruction:** Use LABEL maintainer="..." instead. MAINTAINER deprecated in Dockerfile spec.
- **npm install in production:** Use `npm ci --only=production` for reproducible builds with lockfile.
- **Base node image (node:latest):** Use versioned tags with variant (node:20-slim). Latest is unpredictable, full image is bloated.

## Open Questions

Things that couldn't be fully resolved:

1. **Multi-architecture builds (ARM64 + AMD64)**
   - What we know: Docker buildx supports multi-arch builds with `--platform linux/amd64,linux/arm64`. better-sqlite3 has prebuilt binaries for common platforms.
   - What's unclear: Whether better-sqlite3 prebuild downloads work reliably in multi-arch buildx, or if compilation required per platform adds significant build time. Testing needed.
   - Recommendation: Start with single architecture (linux/amd64). Add ARM64 support in iteration if users request it. Use `docker buildx build --platform linux/amd64,linux/arm64` with separate build stages per platform if needed.

2. **Optimal HEALTHCHECK intervals for SQLite writes**
   - What we know: Default 30s interval is standard. Shorter intervals (5-10s) detect failures faster but increase load. Health check makes HTTP request + database query.
   - What's unclear: Whether frequent health checks impact SQLite WAL performance or cause lock contention under heavy request load. Official docs don't provide guidance on database-backed health checks.
   - Recommendation: Start with 30s interval, 3 retries, 10s start_period. Monitor health check response times in production. If /health averages <100ms, consider 15s interval for faster failure detection.

3. **Database backup strategy in containers**
   - What we know: Docker volumes can be backed up with `docker run --volumes-from` pattern. SQLite backup requires VACUUM INTO or online backup API to handle WAL files correctly.
   - What's unclear: Best practice for automated periodic backups in containerized SQLite. Whether to add backup command to image, use sidecar container, or external cron job.
   - Recommendation: Document manual backup procedure in README: `docker compose exec proxy node -e "require('better-sqlite3')('/app/data/observability.db').backup('/app/data/backup.db')"`. Defer automated backups to operations phase.

## Sources

### Primary (HIGH confidence)
- Docker Official Documentation: Compose file services spec - https://docs.docker.com/reference/compose-file/services/
- Docker Official Documentation: Multi-stage builds - https://docs.docker.com/build/building/multi-stage/
- Docker Official Documentation: Volumes and data persistence - https://docs.docker.com/engine/storage/volumes/
- Docker Official Documentation: Environment variables best practices - https://docs.docker.com/compose/how-tos/environment-variables/best-practices/
- Node.js Docker Official Best Practices - https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md
- better-sqlite3 GitHub Discussion: Alpine compatibility - https://github.com/WiseLibs/better-sqlite3/discussions/1270

### Secondary (MEDIUM confidence)
- Better Stack: Dockerizing Node.js Apps Complete Guide - https://betterstack.com/community/guides/scaling-nodejs/dockerize-nodejs/
- OneUpTime: Node.js Multi-Stage Dockerfile (2026-01-06) - https://oneuptime.com/blog/post/2026-01-06-nodejs-multi-stage-dockerfile/view
- OneUpTime: Docker Volumes for Persistent Data (2026-02-02) - https://oneuptime.com/blog/post/2026-02-02-docker-volumes-persistent-data/view
- Snyk: 10 Best Practices to Containerize Node.js - https://snyk.io/blog/10-best-practices-to-containerize-nodejs-web-applications-with-docker/
- Snyk: Choosing the Best Node.js Docker Image - https://snyk.io/blog/choosing-the-best-node-js-docker-image/
- Last9: Docker Compose Health Checks Guide - https://last9.io/blog/docker-compose-health-checks/
- Medium: Docker Compose Health Checks Practical Guide (2026) - https://medium.com/@cbaah123/docker-compose-health-checks-made-easy-a-practical-guide-3a340571b88e
- Medium: Stopping Docker Containers Safely with dumb-init (2026-01) - https://medium.com/@salimian/stopping-docker-containers-safely-how-dumb-init-saved-my-nestjsworker-88529b5a9f13
- OneUpTime: Docker Container Init Process (2026-01-30) - https://oneuptime.com/blog/post/2026-01-30-docker-init-process/view

### Tertiary (LOW confidence)
- Various Medium and DEV.to articles on Docker best practices (2025-2026) - Community experiences, not authoritative but consistent patterns observed
- WebSearch findings on Alpine vs Debian performance (15% slower claim) - Single Reddit user report, not verified with benchmarks

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Docker official documentation and Node.js team best practices
- Architecture: HIGH - Multi-stage builds well-documented, patterns verified across multiple authoritative sources
- Pitfalls: HIGH - better-sqlite3 Alpine issues confirmed in official GitHub discussions; other pitfalls from official Node.js Docker docs and Docker documentation
- better-sqlite3 specifics: MEDIUM - GitHub discussion threads from maintainers but not in official docs
- Performance comparisons: MEDIUM - Alpine vs Debian size verified, performance claims from community sources

**Research date:** 2026-02-06
**Valid until:** 2026-03-06 (30 days - stable domain, but Docker Compose and Node.js images update regularly)

**Project-specific notes:**
- This project uses better-sqlite3 with WAL mode - Debian-slim base is non-negotiable
- Config file at config/config.yaml must be bind-mounted (user-supplied values)
- Database at ./data/observability.db must use named volume for persistence
- UI built with Vite to ui/dist/ must be copied into final image
- Backend serves UI static files via Hono serveStatic (single container deployment)
- Health endpoint already exists at /health - no implementation needed
- Port 3429 must be exposed and documented
- ESM-only project (type: "module") - ensure NODE_OPTIONS or package.json type preserved
