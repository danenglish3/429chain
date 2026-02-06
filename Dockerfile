# Multi-stage Dockerfile for 429chain
#
# Stage 1: deps - Install production dependencies only (including better-sqlite3 native module)
# Stage 2: builder - Build backend TypeScript with tsdown
# Stage 3: ui-builder - Build Vite React SPA
# Stage 4: production - Minimal runtime image with all built artifacts
#
# Final image runs as non-root node user with health checks enabled.

# Stage 1: Production dependencies
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Stage 2: Build backend TypeScript
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 3: Build Vite React SPA
FROM node:20-slim AS ui-builder
WORKDIR /app/ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui/ ./
RUN npm run build

# Stage 4: Production runtime
FROM node:20-slim
WORKDIR /app

# Install curl for health checks
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Create data directory with proper ownership
RUN mkdir -p /app/data && chown -R node:node /app

# Switch to non-root user
USER node

# Copy production dependencies
COPY --from=deps --chown=node:node /app/node_modules ./node_modules

# Copy built backend
COPY --from=builder --chown=node:node /app/dist ./dist

# Copy built UI
COPY --from=ui-builder --chown=node:node /app/ui/dist ./ui/dist

# Copy package.json for metadata
COPY --chown=node:node package.json ./

# Expose application port
EXPOSE 3429

# Set production environment
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3429/health || exit 1

# Start application
CMD ["node", "dist/index.mjs"]
