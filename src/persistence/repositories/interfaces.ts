/**
 * Repository interfaces for the dual-mode persistence layer.
 * All imports are `import type` to prevent circular dependencies and ensure
 * these interfaces carry zero runtime weight.
 */

import type { ProviderConfig, ChainConfig } from '../../config/types.js';
import type {
  ProviderUsage,
  ChainUsage,
  RequestLogRow,
  SummaryStats,
} from '../aggregator.js';
import type { RequestLogEntry } from '../request-logger.js';

/**
 * Repository interface for admin (config) operations.
 *
 * Read operations are synchronous — both the SQLite (in-memory ref) and future
 * SaaS (cached) implementations return immediately.
 *
 * Write operations are async (Promise<void>) to accommodate future
 * asynchronous Postgres writes without changing the interface.
 */
export interface IAdminRepository {
  /**
   * Return the current list of providers and chains.
   * Used by GET /admin/config.
   */
  getConfig(): { providers: ProviderConfig[]; chains: ChainConfig[] };

  /**
   * Create or update a provider in persistence.
   * Identifies the provider by `provider.id`.
   */
  upsertProvider(provider: ProviderConfig): Promise<void>;

  /**
   * Remove a provider from persistence by id.
   * Throws if the provider does not exist.
   */
  deleteProvider(id: string): Promise<void>;

  /**
   * Create or update a chain in persistence.
   * Identifies the chain by `chain.name`.
   */
  upsertChain(chain: ChainConfig): Promise<void>;

  /**
   * Remove a chain from persistence by name.
   * Throws if the chain does not exist.
   */
  deleteChain(name: string): Promise<void>;
}

/**
 * Repository interface for stats and request-log operations.
 *
 * All operations are synchronous — stats reads come from pre-aggregated SQLite
 * tables (or a future in-memory cache) and logRequest is fire-and-forget.
 */
export interface IStatsRepository {
  /** Get summary statistics across all requests. */
  getSummaryStats(): SummaryStats;

  /** Get usage statistics for all providers. */
  getAllProviderUsage(): ProviderUsage[];

  /** Get usage statistics for a specific provider, or null if not found. */
  getProviderUsage(providerId: string): ProviderUsage | null;

  /** Get usage statistics for all chains. */
  getAllChainUsage(): ChainUsage[];

  /** Get usage statistics for a specific chain, or null if not found. */
  getChainUsage(chainName: string): ChainUsage | null;

  /** Get recent request log rows (most recent first). */
  getRecentRequests(limit: number): RequestLogRow[];

  /** Fire-and-forget: log a completed request. */
  logRequest(entry: RequestLogEntry): void;
}
