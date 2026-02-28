/**
 * SQLite implementation of IAdminRepository.
 *
 * Delegates every operation to the in-memory configRef and the writeConfig
 * helper. Contains ZERO business logic — validation, registry updates, runtime
 * chain-map updates, and default-chain guards all remain in the admin route
 * handler (added in Plan 02).
 */

import type { IAdminRepository } from '../interfaces.js';
import type { Config, ProviderConfig, ChainConfig } from '../../../config/types.js';
import { writeConfig } from '../../../config/writer.js';

export class SqliteAdminRepository implements IAdminRepository {
  constructor(
    private readonly configRef: { current: Config },
    private readonly configPath: string,
  ) {}

  getConfig(): { providers: ProviderConfig[]; chains: ChainConfig[] } {
    return {
      providers: this.configRef.current.providers,
      chains: this.configRef.current.chains,
    };
  }

  async upsertProvider(provider: ProviderConfig): Promise<void> {
    const providers = this.configRef.current.providers;
    const idx = providers.findIndex((p) => p.id === provider.id);
    if (idx !== -1) {
      providers[idx] = provider;
    } else {
      providers.push(provider);
    }
    writeConfig(this.configPath, this.configRef.current);
  }

  async deleteProvider(id: string): Promise<void> {
    const providers = this.configRef.current.providers;
    const idx = providers.findIndex((p) => p.id === id);
    if (idx === -1) {
      throw new Error('Provider not found');
    }
    providers.splice(idx, 1);
    writeConfig(this.configPath, this.configRef.current);
  }

  async upsertChain(chain: ChainConfig): Promise<void> {
    const chains = this.configRef.current.chains;
    const idx = chains.findIndex((c) => c.name === chain.name);
    if (idx !== -1) {
      chains[idx] = chain;
    } else {
      chains.push(chain);
    }
    writeConfig(this.configPath, this.configRef.current);
  }

  async deleteChain(name: string): Promise<void> {
    const chains = this.configRef.current.chains;
    const idx = chains.findIndex((c) => c.name === name);
    if (idx === -1) {
      throw new Error('Chain not found');
    }
    chains.splice(idx, 1);
    writeConfig(this.configPath, this.configRef.current);
  }
}
