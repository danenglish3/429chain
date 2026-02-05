/**
 * Rate limit tracking types.
 * Defines the state model for per-provider+model rate limit tracking.
 */

/** Rate limit state for a provider+model pair. */
export type RateLimitState = 'available' | 'exhausted';

/** Public-facing cooldown entry for monitoring and observability. */
export interface CooldownEntry {
  /** Provider instance ID. */
  providerId: string;
  /** Model ID. */
  model: string;
  /** Current rate limit state. */
  status: RateLimitState;
  /** Unix timestamp (ms) when cooldown expires, or null if available. */
  cooldownUntil: number | null;
  /** Human-readable reason for the current state. */
  reason: string;
}

/** Internal tracker state entry. */
export interface TrackerEntry {
  /** Current rate limit state. */
  status: RateLimitState;
  /** Unix timestamp (ms) when cooldown expires, or null if available. */
  cooldownUntil: number | null;
  /** Human-readable reason for the current state. */
  reason: string;
}
