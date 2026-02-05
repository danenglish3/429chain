/**
 * 429chain application entry point.
 * Bootstraps configuration, provider registry, chains, rate limit tracker,
 * creates the Hono application with routes, and starts the HTTP server.
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { logger } from './shared/logger.js';
import { loadConfig, resolveConfigPath } from './config/loader.js';
import { buildRegistry } from './providers/registry.js';
import { buildChains } from './chain/types.js';
import { RateLimitTracker } from './ratelimit/tracker.js';
import { createAuthMiddleware } from './api/middleware/auth.js';
import { errorHandler } from './api/middleware/error-handler.js';
import { createChatRoutes } from './api/routes/chat.js';
import { createModelsRoutes } from './api/routes/models.js';
import { createHealthRoutes } from './api/routes/health.js';

// --- Bootstrap ---

logger.info('429chain v0.1.0 starting...');

const configPath = resolveConfigPath();
const config = loadConfig(configPath);

// Update logger level from config
logger.level = config.settings.logLevel;

const registry = buildRegistry(config.providers);
const chains = buildChains(config, registry);
const tracker = new RateLimitTracker(config.settings.cooldownDefaultMs);

// --- Create Hono application ---

const app = new Hono();

// Global error handler
app.onError(errorHandler);

// Health route (no auth required)
const healthRoutes = createHealthRoutes(registry, chains);
app.route('/health', healthRoutes);

// Auth-protected v1 routes
const auth = createAuthMiddleware(config.settings.apiKeys);
const v1 = new Hono();
v1.use('*', auth);

const chatRoutes = createChatRoutes(chains, tracker, registry, config.settings.defaultChain);
const modelsRoutes = createModelsRoutes(chains);

v1.route('/', chatRoutes);
v1.route('/', modelsRoutes);

app.route('/v1', v1);

// --- Start server ---

const server = serve(
  {
    fetch: app.fetch,
    port: config.settings.port,
  },
  (info) => {
    logger.info(
      { port: info.port },
      `429chain listening on port ${info.port}`,
    );
    logger.info(
      {
        providers: registry.size,
        chains: chains.size,
        defaultChain: config.settings.defaultChain,
      },
      'Ready',
    );
  },
);

// --- Graceful shutdown ---

const shutdown = () => {
  logger.info('Shutting down...');
  tracker.shutdown();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// --- Unhandled rejection handler ---

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection');
});
