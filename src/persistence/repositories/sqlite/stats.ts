/**
 * SQLite implementation of IStatsRepository.
 *
 * Pure delegation to UsageAggregator (reads) and RequestLogger (writes).
 * Contains zero additional logic.
 */

import type { IStatsRepository } from '../interfaces.js';
import type {
  ProviderUsage,
  ChainUsage,
  RequestLogRow,
  SummaryStats,
} from '../../aggregator.js';
import type { RequestLogEntry } from '../../request-logger.js';
import { UsageAggregator } from '../../aggregator.js';
import { RequestLogger } from '../../request-logger.js';

export class SqliteStatsRepository implements IStatsRepository {
  constructor(
    private readonly aggregator: UsageAggregator,
    private readonly requestLogger: RequestLogger,
  ) {}

  getSummaryStats(): SummaryStats {
    return this.aggregator.getSummaryStats();
  }

  getAllProviderUsage(): ProviderUsage[] {
    return this.aggregator.getAllProviderUsage();
  }

  getProviderUsage(providerId: string): ProviderUsage | null {
    return this.aggregator.getProviderUsage(providerId);
  }

  getAllChainUsage(): ChainUsage[] {
    return this.aggregator.getAllChainUsage();
  }

  getChainUsage(chainName: string): ChainUsage | null {
    return this.aggregator.getChainUsage(chainName);
  }

  getRecentRequests(limit: number): RequestLogRow[] {
    return this.aggregator.getRecentRequests(limit);
  }

  logRequest(entry: RequestLogEntry): void {
    this.requestLogger.logRequest(entry);
  }
}
