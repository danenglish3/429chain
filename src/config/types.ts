/**
 * TypeScript types inferred from Zod schemas.
 * These types are the compile-time companions to the runtime validation schemas.
 */

import { z } from 'zod';
import {
  ConfigSchema,
  ProviderSchema,
  ChainSchema,
  ChainEntrySchema,
  SettingsSchema,
  RateLimitConfigSchema,
} from './schema.js';

/** Fully validated proxy configuration. */
export type Config = z.infer<typeof ConfigSchema>;

/** A single provider configuration. */
export type ProviderConfig = z.infer<typeof ProviderSchema>;

/** A named chain of provider+model entries. */
export type ChainConfig = z.infer<typeof ChainSchema>;

/** A single entry in a chain (provider id + model). */
export type ChainEntryConfig = z.infer<typeof ChainEntrySchema>;

/** Proxy-level settings. */
export type Settings = z.infer<typeof SettingsSchema>;

/** Per-provider rate limit configuration (manual fallback). */
export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;

// Re-export schemas for convenience
export {
  ConfigSchema,
  ProviderSchema,
  ChainSchema,
  ChainEntrySchema,
  SettingsSchema,
  RateLimitConfigSchema,
} from './schema.js';
