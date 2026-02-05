/**
 * In-memory rate limit tracker with per-provider+model state.
 * Tracks which provider+model pairs are exhausted (429) and manages
 * cooldown timers for automatic recovery.
 *
 * Key design: composite key `${providerId}:${model}` because rate limits
 * are per provider+model, not just per provider. A provider may have
 * different rate limits for different models.
 */

import { logger } from '../shared/logger.js';
import { CooldownManager } from './cooldown.js';
import type { CooldownEntry, RateLimitState, TrackerEntry } from './types.js';

/**
 * Manages rate limit state for provider+model pairs.
 * Provides isExhausted checks for the chain router and
 * markExhausted/markAvailable transitions for the waterfall logic.
 */
export class RateLimitTracker {
  private state = new Map<string, TrackerEntry>();
  private cooldownManager: CooldownManager;
  private defaultCooldownMs: number;

  /**
   * @param defaultCooldownMs - Default cooldown duration when no retry-after
   *   header is available. Typically from config.settings.cooldownDefaultMs.
   */
  constructor(defaultCooldownMs: number) {
    this.defaultCooldownMs = defaultCooldownMs;
    this.cooldownManager = new CooldownManager();
  }

  /** Build the composite key for a provider+model pair. */
  private key(providerId: string, model: string): string {
    return `${providerId}:${model}`;
  }

  /**
   * Check if a provider+model pair is currently exhausted (on cooldown).
   * Includes a race-condition safety check: if the cooldown time has passed
   * but the timer hasn't fired yet, mark available immediately.
   */
  isExhausted(providerId: string, model: string): boolean {
    const entry = this.state.get(this.key(providerId, model));

    // Not tracked or explicitly available
    if (!entry || entry.status === 'available') {
      return false;
    }

    // Exhausted but cooldown has expired (timer race condition safety)
    if (
      entry.status === 'exhausted' &&
      entry.cooldownUntil !== null &&
      Date.now() >= entry.cooldownUntil
    ) {
      this.markAvailable(providerId, model);
      return false;
    }

    return true;
  }

  /**
   * Mark a provider+model pair as exhausted with a cooldown timer.
   * If already exhausted, the existing timer is replaced (not accumulated).
   * @param providerId - Provider instance ID.
   * @param model - Model ID.
   * @param retryAfterMs - Explicit cooldown from retry-after header, in ms.
   * @param reason - Human-readable reason for the exhaustion.
   */
  markExhausted(
    providerId: string,
    model: string,
    retryAfterMs?: number,
    reason?: string,
  ): void {
    const k = this.key(providerId, model);
    const cooldownMs = retryAfterMs ?? this.defaultCooldownMs;
    const cooldownUntil = Date.now() + cooldownMs;

    this.state.set(k, {
      status: 'exhausted',
      cooldownUntil,
      reason: reason ?? '429 rate limited',
    });

    // Schedule auto-recovery timer (replaces existing if any)
    this.cooldownManager.schedule(k, cooldownMs, () => {
      this.markAvailable(providerId, model);
    });

    logger.info(
      { providerId, model, cooldownMs },
      `Provider ${providerId}/${model} exhausted, cooldown ${cooldownMs}ms`,
    );
  }

  /**
   * Mark a provider+model pair as available again.
   * Cancels any pending cooldown timer.
   */
  markAvailable(providerId: string, model: string): void {
    const k = this.key(providerId, model);

    this.state.set(k, {
      status: 'available',
      cooldownUntil: null,
      reason: '',
    });

    this.cooldownManager.cancel(k);

    logger.debug(
      { providerId, model },
      `Provider ${providerId}/${model} available again`,
    );
  }

  /**
   * Get the current status of a specific provider+model pair.
   * Useful for monitoring and debugging.
   */
  getStatus(providerId: string, model: string): CooldownEntry {
    const k = this.key(providerId, model);
    const entry = this.state.get(k);

    if (!entry) {
      return {
        providerId,
        model,
        status: 'available' as RateLimitState,
        cooldownUntil: null,
        reason: '',
      };
    }

    return {
      providerId,
      model,
      status: entry.status,
      cooldownUntil: entry.cooldownUntil,
      reason: entry.reason,
    };
  }

  /**
   * Get all tracked provider+model statuses.
   * Returns entries for all provider+model pairs that have been tracked.
   */
  getAllStatuses(): CooldownEntry[] {
    const entries: CooldownEntry[] = [];

    for (const [k, entry] of this.state) {
      const separatorIndex = k.indexOf(':');
      const providerId = k.substring(0, separatorIndex);
      const model = k.substring(separatorIndex + 1);

      entries.push({
        providerId,
        model,
        status: entry.status,
        cooldownUntil: entry.cooldownUntil,
        reason: entry.reason,
      });
    }

    return entries;
  }

  /**
   * Shut down the tracker, cancelling all pending cooldown timers.
   * Call this during graceful process shutdown.
   */
  shutdown(): void {
    this.cooldownManager.cancelAll();
    logger.debug('RateLimitTracker shut down, all timers cancelled');
  }
}
