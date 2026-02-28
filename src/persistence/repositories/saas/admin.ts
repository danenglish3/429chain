/**
 * SaaS stub for IAdminRepository.
 *
 * Every method throws until Phase 11 implements the real Postgres/Supabase
 * persistence. The stub exists now so the factory can return a structurally
 * valid IAdminRepository in saas mode.
 */

import type { IAdminRepository } from '../interfaces.js';
import type { ProviderConfig, ChainConfig } from '../../../config/types.js';

export class SaasAdminRepository implements IAdminRepository {
  getConfig(): never {
    throw new Error('SaaS admin repository not yet implemented (Phase 11)');
  }

  async upsertProvider(_provider: ProviderConfig): Promise<never> {
    throw new Error('SaaS admin repository not yet implemented (Phase 11)');
  }

  async deleteProvider(_id: string): Promise<never> {
    throw new Error('SaaS admin repository not yet implemented (Phase 11)');
  }

  async upsertChain(_chain: ChainConfig): Promise<never> {
    throw new Error('SaaS admin repository not yet implemented (Phase 11)');
  }

  async deleteChain(_name: string): Promise<never> {
    throw new Error('SaaS admin repository not yet implemented (Phase 11)');
  }
}
