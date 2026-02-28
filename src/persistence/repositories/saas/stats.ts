/**
 * SaaS stub for IStatsRepository.
 *
 * Every method throws until Phase 11 implements the real Postgres/Supabase
 * persistence. The stub exists now so the factory can return a structurally
 * valid IStatsRepository in saas mode.
 */

import type { IStatsRepository } from '../interfaces.js';
import type {
  ProviderUsage,
  ChainUsage,
  RequestLogRow,
  SummaryStats,
} from '../../aggregator.js';
import type { RequestLogEntry } from '../../request-logger.js';

export class SaasStatsRepository implements IStatsRepository {
  getSummaryStats(): never {
    throw new Error('SaaS stats repository not yet implemented (Phase 11)');
  }

  getAllProviderUsage(): never {
    throw new Error('SaaS stats repository not yet implemented (Phase 11)');
  }

  getProviderUsage(_providerId: string): never {
    throw new Error('SaaS stats repository not yet implemented (Phase 11)');
  }

  getAllChainUsage(): never {
    throw new Error('SaaS stats repository not yet implemented (Phase 11)');
  }

  getChainUsage(_chainName: string): never {
    throw new Error('SaaS stats repository not yet implemented (Phase 11)');
  }

  getRecentRequests(_limit: number): never {
    throw new Error('SaaS stats repository not yet implemented (Phase 11)');
  }

  logRequest(_entry: RequestLogEntry): never {
    throw new Error('SaaS stats repository not yet implemented (Phase 11)');
  }
}
