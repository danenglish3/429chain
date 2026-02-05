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
import { initializeDatabase } from './persistence/db.js';
import { migrateSchema } from './persistence/schema.js';
import { RequestLogger } from './persistence/request-logger.js';
import { UsageAggregator } from './persistence/aggregator.js';
import { createStatsRoutes } from './api/routes/stats.js';
import { createRateLimitRoutes } from './api/routes/ratelimits.js';

// --- Bootstrap ---

logger.info('429chain v0.1.0 starting...');

const configPath = resolveConfigPath();
const config = loadConfig(configPath);

// Update logger level from config
logger.level = config.settings.logLevel;

const registry = buildRegistry(config.providers);
const chains = buildChains(config, registry);
const tracker = new RateLimitTracker(config.settings.cooldownDefaultMs);

// --- Register manual rate limits from config ---

let manualLimitCount = 0;
for (const provider of config.providers) {
  if (!provider.rateLimits) continue;

  // Collect all models used with this provider across all chains
  const models = new Set<string>();
  for (const chainConfig of config.chains) {
    for (const entry of chainConfig.entries) {
      if (entry.provider === provider.id) {
        models.add(entry.model);
      }
    }
  }

  // Register manual limits for each provider+model pair
  for (const model of models) {
    tracker.registerManualLimits(provider.id, model, provider.rateLimits);
    manualLimitCount++;
  }
}

if (manualLimitCount > 0) {
  logger.info({ count: manualLimitCount }, `Registered ${manualLimitCount} manual rate limit(s)`);
}

// --- Initialize observability database ---
const db = initializeDatabase(config.settings.dbPath);
migrateSchema(db);
const requestLogger = new RequestLogger(db);
const aggregator = new UsageAggregator(db);

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

const chatRoutes = createChatRoutes(chains, tracker, registry, config.settings.defaultChain, requestLogger);
const modelsRoutes = createModelsRoutes(chains);
const statsRoutes = createStatsRoutes(aggregator);
const rateLimitRoutes = createRateLimitRoutes(tracker);

v1.route('/', chatRoutes);
v1.route('/', modelsRoutes);
v1.route('/stats', statsRoutes);
v1.route('/ratelimits', rateLimitRoutes);

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
        dbPath: config.settings.dbPath,
      },
      'Ready',
    );
  },
);

// --- Graceful shutdown ---

const shutdown = () => {
  logger.info('Shutting down...');
  tracker.shutdown();
  db.close();
  logger.info('Database closed');
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
