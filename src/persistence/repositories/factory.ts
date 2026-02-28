/**
 * Repository factory with mode-based dynamic imports.
 *
 * ARCH-06: Single entry point that resolves the correct repository
 * implementations based on APP_MODE.
 *
 * ARCH-07: SaaS files are NEVER statically imported — both branches use
 * dynamic `await import()` so the bundler/runtime only loads what is needed.
 */

import type { IAdminRepository, IStatsRepository } from './interfaces.js';
import type { Config } from '../../config/types.js';
import type { UsageAggregator } from '../aggregator.js';
import type { RequestLogger } from '../request-logger.js';
import { logger } from '../../shared/logger.js';

/** The two supported application modes. */
export type AppMode = 'self-hosted' | 'saas';

/** The resolved repository pair returned by createRepositories. */
export interface Repositories {
  admin: IAdminRepository;
  stats: IStatsRepository;
}

/** Dependencies required when running in self-hosted mode. */
interface SelfHostedDeps {
  configRef: { current: Config };
  configPath: string;
  aggregator: UsageAggregator;
  requestLogger: RequestLogger;
}

/**
 * Create the admin and stats repositories for the given application mode.
 *
 * Both branches use dynamic imports so neither sqlite/ nor saas/ modules are
 * loaded until this function is called — keeping the module graph clean and
 * enabling true tree-shaking / lazy loading.
 *
 * @param mode  'self-hosted' (default) or 'saas'
 * @param deps  Required for self-hosted mode; omit for saas mode.
 */
export async function createRepositories(
  mode: AppMode,
  deps?: SelfHostedDeps,
): Promise<Repositories> {
  if (mode === 'saas') {
    const [{ SaasAdminRepository }, { SaasStatsRepository }] = await Promise.all([
      import('./saas/admin.js'),
      import('./saas/stats.js'),
    ]);
    logger.info('saas mode');
    return {
      admin: new SaasAdminRepository(),
      stats: new SaasStatsRepository(),
    };
  }

  // Default: self-hosted
  const { SqliteAdminRepository } = await import('./sqlite/admin.js');
  const { SqliteStatsRepository } = await import('./sqlite/stats.js');
  logger.info('self-hosted mode');
  return {
    admin: new SqliteAdminRepository(deps!.configRef, deps!.configPath),
    stats: new SqliteStatsRepository(deps!.aggregator, deps!.requestLogger),
  };
}
