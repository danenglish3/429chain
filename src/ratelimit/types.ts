/**
 * Rate limit tracking types.
 * Defines the state model for per-provider+model rate limit tracking.
 */

/** Rate limit state for a provider+model pair. */
export type RateLimitState = 'available' | 'tracking' | 'exhausted';

/** Quota information from parsed rate limit headers. */
export interface QuotaInfo {
  /** Requests remaining in the current window. */
  remainingRequests?: number;
  /** Milliseconds until the request limit resets. */
  resetRequestsMs?: number;
  /** Tokens remaining in the current window. */
  remainingTokens?: number;
  /** Milliseconds until the token limit resets. */
  resetTokensMs?: number;
  /** Timestamp when this quota info was last updated (Date.now()). */
  lastUpdated: number;
}

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
  /** Optional quota information for tracking state. */
  quota?: QuotaInfo;
}

/** Internal tracker state entry. */
export interface TrackerEntry {
  /** Current rate limit state. */
  status: RateLimitState;
  /** Unix timestamp (ms) when cooldown expires, or null if available. */
  cooldownUntil: number | null;
  /** Human-readable reason for the current state. */
  reason: string;
  /** Optional quota information for tracking state. */
  quota?: QuotaInfo;
}
