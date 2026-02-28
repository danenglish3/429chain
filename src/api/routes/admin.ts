/**
 * Admin CRUD routes for managing providers and chains at runtime.
 * All mutations persist back to the repository (SQLite in self-hosted mode).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { ProviderSchema, ChainEntrySchema } from '../../config/schema.js';
import type { ProviderConfig, ChainConfig } from '../../config/types.js';
import type { ProviderRegistry } from '../../providers/types.js';
import type { Chain } from '../../chain/types.js';
import type { RateLimitTracker } from '../../ratelimit/tracker.js';
import type { IAdminRepository } from '../../persistence/repositories/interfaces.js';
import { createAdapter } from '../../providers/registry.js';
import { logger } from '../../shared/logger.js';

/**
 * Dependencies for admin routes.
 */
interface AdminRouteDeps {
  /** Admin repository for config reads and writes. */
  admin: IAdminRepository;
  /** Provider registry for adapter management. */
  registry: ProviderRegistry;
  /** Runtime chains map for chain management. */
  chains: Map<string, Chain>;
  /** Rate limit tracker for cleanup when providers are removed. */
  tracker: RateLimitTracker;
  /** Default chain name — used to guard against deletion of the default chain. */
  defaultChain: string;
}

/**
 * Create admin routes with injected dependencies.
 * @param deps - Admin route dependencies
 * @returns Hono sub-app with admin endpoints
 */
export function createAdminRoutes(deps: AdminRouteDeps) {
  const { admin, registry, chains, tracker, defaultChain } = deps;
  const app = new Hono();

  // GET /config - Return current config (providers and chains, with masked API keys)
  app.get('/config', (c) => {
    const { providers, chains: chainConfigs } = admin.getConfig();
    const maskedProviders = providers.map((p) => ({
      ...p,
      apiKey: '***',
    }));

    return c.json({
      providers: maskedProviders,
      chains: chainConfigs,
    });
  });

  // PUT /providers/:id - Create or update a provider
  app.put('/providers/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();

    // Validate with ProviderSchema
    const result = ProviderSchema.safeParse(body);
    if (!result.success) {
      const prettyError = z.prettifyError(result.error);
      return c.json({ error: prettyError }, 400);
    }

    const providerConfig = result.data;

    // Ensure the ID in the path matches the ID in the body
    if (providerConfig.id !== id) {
      return c.json({ error: 'Provider ID in path must match ID in body' }, 400);
    }

    // Create the adapter (validates provider type and baseUrl requirements)
    let adapter;
    try {
      adapter = createAdapter(providerConfig);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }

    // Update registry
    registry.add(id, adapter);

    // Persist via repository
    try {
      await admin.upsertProvider(providerConfig);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to persist config: ${message}` }, 500);
    }

    logger.info({ providerId: id }, 'Upserted provider');

    return c.json({
      provider: {
        ...providerConfig,
        apiKey: '***',
      },
    });
  });

  // DELETE /providers/:id - Remove a provider
  app.delete('/providers/:id', async (c) => {
    const id = c.req.param('id');

    // Check if provider exists
    const { providers, chains: chainConfigs } = admin.getConfig();
    const existingIndex = providers.findIndex((p) => p.id === id);
    if (existingIndex === -1) {
      return c.json({ error: 'Provider not found' }, 404);
    }

    // Check if any chains reference this provider
    const referencingChains: string[] = [];
    for (const chain of chainConfigs) {
      const hasReference = chain.entries.some((entry) => entry.provider === id);
      if (hasReference) {
        referencingChains.push(chain.name);
      }
    }

    if (referencingChains.length > 0) {
      return c.json(
        { error: `Provider is referenced by chains: ${referencingChains.join(', ')}` },
        400
      );
    }

    // Remove from registry
    registry.remove(id);

    // Persist via repository
    try {
      await admin.deleteProvider(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to persist config: ${message}` }, 500);
    }

    logger.info({ providerId: id }, 'Deleted provider');
    return c.json({ deleted: id });
  });

  // PUT /chains/:name - Create or update a chain
  app.put('/chains/:name', async (c) => {
    const name = c.req.param('name');
    const body = await c.req.json();

    // Validate entries array
    const entriesSchema = z.array(ChainEntrySchema).min(1);
    const result = entriesSchema.safeParse(body.entries);
    if (!result.success) {
      const prettyError = z.prettifyError(result.error);
      return c.json({ error: prettyError }, 400);
    }

    const entries = result.data;

    // Validate that all provider IDs exist in registry
    const missingProviders: string[] = [];
    for (const entry of entries) {
      if (!registry.has(entry.provider)) {
        missingProviders.push(entry.provider);
      }
    }

    if (missingProviders.length > 0) {
      return c.json(
        { error: `Chain references non-existent providers: ${missingProviders.join(', ')}` },
        400
      );
    }

    // Build the chain config object
    const chainConfig: ChainConfig = {
      name,
      entries,
    };

    // Build the runtime Chain object and update the chains Map
    const runtimeChain: Chain = {
      name,
      entries: entries.map((e) => ({
        providerId: e.provider,
        model: e.model,
      })),
    };
    chains.set(name, runtimeChain);

    // Persist via repository
    try {
      await admin.upsertChain(chainConfig);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to persist config: ${message}` }, 500);
    }

    logger.info({ chainName: name }, 'Upserted chain');

    return c.json({
      chain: chainConfig,
    });
  });

  // DELETE /chains/:name - Remove a chain
  app.delete('/chains/:name', async (c) => {
    const name = c.req.param('name');

    // Check if chain exists
    const { chains: chainConfigs } = admin.getConfig();
    const exists = chainConfigs.some((ch) => ch.name === name);
    if (!exists) {
      return c.json({ error: 'Chain not found' }, 404);
    }

    // Prevent deleting the default chain
    if (name === defaultChain) {
      return c.json({ error: 'Cannot delete default chain' }, 400);
    }

    // Remove from chains Map
    chains.delete(name);

    // Persist via repository
    try {
      await admin.deleteChain(name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Failed to persist config: ${message}` }, 500);
    }

    logger.info({ chainName: name }, 'Deleted chain');
    return c.json({ deleted: name });
  });

  return app;
}
