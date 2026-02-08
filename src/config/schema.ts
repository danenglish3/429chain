/**
 * Zod schemas for YAML config file validation.
 * These schemas are the single source of truth for config structure.
 * TypeScript types are inferred from these schemas in types.ts.
 */

import { z } from 'zod';

/** Schema for optional per-provider rate limit configuration (fallback when headers unavailable). */
export const RateLimitConfigSchema = z.object({
  requestsPerMinute: z.number().int().positive().optional(),
  tokensPerMinute: z.number().int().positive().optional(),
  requestsPerDay: z.number().int().positive().optional(),
  concurrentRequests: z.number().int().positive().optional(),
});

/** Schema for a single provider definition. */
export const ProviderSchema = z.object({
  id: z.string().min(1, { message: 'Provider id must not be empty' }),
  name: z.string().min(1, { message: 'Provider name must not be empty' }),
  type: z.enum(['openrouter', 'groq', 'cerebras', 'openai', 'generic-openai']),
  apiKey: z.string().min(1, { message: 'Provider apiKey must not be empty' }),
  baseUrl: z.url({ message: 'Provider baseUrl must be a valid URL' }).optional(),
  timeout: z.number().int().min(1000).optional(),
  rateLimits: RateLimitConfigSchema.optional(),
});

/** Schema for a single chain entry (provider + model pair). */
export const ChainEntrySchema = z.object({
  provider: z.string().min(1, { message: 'Chain entry provider must not be empty' }),
  model: z.string().min(1, { message: 'Chain entry model must not be empty' }),
});

/** Schema for a named chain of provider+model entries. */
export const ChainSchema = z.object({
  name: z.string().min(1, { message: 'Chain name must not be empty' }),
  entries: z
    .array(ChainEntrySchema)
    .min(1, { message: 'Chain must have at least one entry' }),
});

/** Schema for proxy settings. */
export const SettingsSchema = z.object({
  port: z.number().int().min(1).max(65535).default(3429),
  apiKeys: z
    .array(z.string().min(1, { message: 'API key must not be empty' }))
    .min(1, { message: 'At least one API key is required' }),
  defaultChain: z.string().min(1, { message: 'defaultChain must not be empty' }),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  cooldownDefaultMs: z.number().int().min(1000).default(60000),
  requestTimeoutMs: z.number().int().min(1000).default(30000),
  dbPath: z.string().default('./data/observability.db'),
  normalizeResponses: z.boolean().default(false),
  midStreamFailureThreshold: z.number().int().min(1).default(3),
  midStreamCooldownMs: z.number().int().min(1000).default(120000),
  midStreamCooldownMaxMs: z.number().int().min(1000).default(1800000),
});

/** Top-level config schema with cross-reference validation. */
export const ConfigSchema = z
  .object({
    version: z.literal(1),
    settings: SettingsSchema,
    providers: z
      .array(ProviderSchema)
      .min(1, { message: 'At least one provider is required' }),
    chains: z
      .array(ChainSchema)
      .min(1, { message: 'At least one chain is required' }),
  })
  .refine(
    (config) => {
      const providerIds = new Set(config.providers.map((p) => p.id));
      return config.chains.every((chain) =>
        chain.entries.every((entry) => providerIds.has(entry.provider))
      );
    },
    {
      message:
        'Chain entries reference a provider id that does not exist in the providers list',
    }
  )
  .refine(
    (config) => {
      const chainNames = new Set(config.chains.map((c) => c.name));
      return chainNames.has(config.settings.defaultChain);
    },
    {
      message:
        'settings.defaultChain must reference an existing chain name',
    }
  );
