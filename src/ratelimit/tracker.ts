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
import type { RateLimitInfo } from '../providers/types.js';

/**
 * Manual rate limit state for a provider+model pair.
 * Used when provider doesn't send rate limit headers.
 */
interface ManualLimitState {
  requestsPerMinute?: number;
  tokensPerMinute?: number;
  requestsPerDay?: number;
  // Tracking counters
  requestCount: number;
  tokenCount: number;
  windowStart: number; // Date.now() when current minute window started
  dailyRequestCount: number;
  dailyWindowStart: number; // Date.now() when current day window started
}

/**
 * Manages rate limit state for provider+model pairs.
 * Provides isExhausted checks for the chain router and
 * markExhausted/markAvailable transitions for the waterfall logic.
 */
export class RateLimitTracker {
  private state = new Map<string, TrackerEntry>();
  private cooldownManager: CooldownManager;
  private defaultCooldownMs: number;
  private manualLimits = new Map<string, ManualLimitState>();
  private midStreamFailures = new Map<string, number>();
  private midStreamEscalation = new Map<string, number>();

  /**
   * @param defaultCooldownMs - Default cooldown duration when no retry-after
   *   header is available. Typically from config.settings.cooldownDefaultMs.
   * @param midStreamFailureThreshold - Number of consecutive mid-stream failures before cooldown.
   * @param midStreamCooldownMs - Base cooldown duration for mid-stream failures (doubles each cycle).
   * @param midStreamCooldownMaxMs - Maximum escalated cooldown duration.
   */
  constructor(
    defaultCooldownMs: number,
    private readonly midStreamFailureThreshold: number = 3,
    private readonly midStreamCooldownMs: number = 120000,
    private readonly midStreamCooldownMaxMs: number = 1800000,
  ) {
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

    // Not tracked, explicitly available, or tracking with quota remaining
    if (!entry || entry.status === 'available' || entry.status === 'tracking') {
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
   * Update quota information for a provider+model pair.
   * Transitions to 'tracking' state if quota remains, or 'exhausted' if depleted.
   * Proactively marks exhausted when remainingRequests or remainingTokens hits zero.
   */
  updateQuota(
    providerId: string,
    model: string,
    info: RateLimitInfo,
  ): void {
    const k = this.key(providerId, model);

    // Check if either limit is exhausted
    const requestsExhausted = info.remainingRequests === 0;
    const tokensExhausted = info.remainingTokens === 0;

    if (requestsExhausted || tokensExhausted) {
      // Proactive exhaustion - quota depleted
      let cooldownMs: number | undefined;
      let reason: string;

      if (requestsExhausted && tokensExhausted) {
        // Both exhausted - use the longer cooldown
        cooldownMs = Math.max(
          info.resetRequestsMs ?? 0,
          info.resetTokensMs ?? 0,
        );
        reason = 'proactive: remaining requests and tokens = 0';
      } else if (requestsExhausted) {
        cooldownMs = info.resetRequestsMs;
        reason = 'proactive: remaining requests = 0';
      } else {
        cooldownMs = info.resetTokensMs;
        reason = 'proactive: remaining tokens = 0';
      }

      this.markExhausted(providerId, model, cooldownMs, reason);
    } else {
      // Still has quota - transition to tracking state
      this.state.set(k, {
        status: 'tracking',
        cooldownUntil: null,
        reason: 'tracking quota',
        quota: {
          remainingRequests: info.remainingRequests,
          resetRequestsMs: info.resetRequestsMs,
          remainingTokens: info.remainingTokens,
          resetTokensMs: info.resetTokensMs,
          lastUpdated: Date.now(),
        },
      });

      logger.debug(
        {
          providerId,
          model,
          remainingRequests: info.remainingRequests,
          remainingTokens: info.remainingTokens,
        },
        `Provider ${providerId}/${model} quota updated`,
      );
    }
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
      quota: entry.quota,
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
        quota: entry.quota,
      });
    }

    return entries;
  }

  /**
   * Register manual rate limits for a provider+model pair.
   * Used as fallback when provider doesn't send rate limit headers.
   * @param providerId - Provider instance ID.
   * @param model - Model ID.
   * @param limits - Manual rate limit configuration.
   */
  registerManualLimits(
    providerId: string,
    model: string,
    limits: {
      requestsPerMinute?: number;
      tokensPerMinute?: number;
      requestsPerDay?: number;
    },
  ): void {
    const k = this.key(providerId, model);
    const now = Date.now();

    this.manualLimits.set(k, {
      requestsPerMinute: limits.requestsPerMinute,
      tokensPerMinute: limits.tokensPerMinute,
      requestsPerDay: limits.requestsPerDay,
      requestCount: 0,
      tokenCount: 0,
      windowStart: now,
      dailyRequestCount: 0,
      dailyWindowStart: now,
    });

    logger.debug(
      { providerId, model, limits },
      `Registered manual rate limits for ${providerId}/${model}`,
    );
  }

  /**
   * Check if manual rate limits are registered for a provider+model pair.
   * Used by the chain router to determine whether to call recordRequest().
   * @param providerId - Provider instance ID.
   * @param model - Model ID.
   * @returns True if manual limits are registered.
   */
  hasManualLimits(providerId: string, model: string): boolean {
    return this.manualLimits.has(this.key(providerId, model));
  }

  /**
   * Record a request and enforce manual rate limits.
   * Only called when provider doesn't send rate limit headers (fallback).
   * @param providerId - Provider instance ID.
   * @param model - Model ID.
   * @param tokensUsed - Optional token count for this request.
   */
  recordRequest(providerId: string, model: string, tokensUsed?: number): void {
    const k = this.key(providerId, model);
    const state = this.manualLimits.get(k);

    // No manual limits registered - no-op
    if (!state) {
      return;
    }

    const now = Date.now();
    const MINUTE_MS = 60_000;
    const DAY_MS = 86_400_000;

    // Reset minute window if elapsed
    if (now - state.windowStart > MINUTE_MS) {
      state.requestCount = 0;
      state.tokenCount = 0;
      state.windowStart = now;
    }

    // Reset daily window if elapsed
    if (now - state.dailyWindowStart > DAY_MS) {
      state.dailyRequestCount = 0;
      state.dailyWindowStart = now;
    }

    // Increment counters
    state.requestCount++;
    if (tokensUsed !== undefined) {
      state.tokenCount += tokensUsed;
    }
    state.dailyRequestCount++;

    // Check for limit exhaustion
    if (
      state.requestsPerMinute !== undefined &&
      state.requestCount >= state.requestsPerMinute
    ) {
      const cooldownMs = MINUTE_MS - (now - state.windowStart);
      this.markExhausted(
        providerId,
        model,
        cooldownMs,
        'manual limit: RPM exceeded',
      );
      return;
    }

    if (
      state.tokensPerMinute !== undefined &&
      state.tokenCount >= state.tokensPerMinute
    ) {
      const cooldownMs = MINUTE_MS - (now - state.windowStart);
      this.markExhausted(
        providerId,
        model,
        cooldownMs,
        'manual limit: TPM exceeded',
      );
      return;
    }

    if (
      state.requestsPerDay !== undefined &&
      state.dailyRequestCount >= state.requestsPerDay
    ) {
      const cooldownMs = DAY_MS - (now - state.dailyWindowStart);
      this.markExhausted(
        providerId,
        model,
        cooldownMs,
        'manual limit: daily request limit exceeded',
      );
      return;
    }
  }

  /**
   * Record a mid-stream failure for a provider+model pair.
   * After threshold consecutive failures, mark provider+model as exhausted.
   * @param providerId - Provider instance ID.
   * @param model - Model ID.
   */
  recordMidStreamFailure(providerId: string, model: string): void {
    const k = this.key(providerId, model);
    const count = (this.midStreamFailures.get(k) ?? 0) + 1;
    this.midStreamFailures.set(k, count);

    if (count >= this.midStreamFailureThreshold) {
      // Escalate: double cooldown each cycle, capped at max
      const escalation = this.midStreamEscalation.get(k) ?? 0;
      const cooldownMs = Math.min(
        this.midStreamCooldownMs * Math.pow(2, escalation),
        this.midStreamCooldownMaxMs,
      );
      this.midStreamEscalation.set(k, escalation + 1);

      this.markExhausted(
        providerId,
        model,
        cooldownMs,
        `mid-stream failures exceeded threshold (cooldown #${escalation + 1})`,
      );
      this.midStreamFailures.set(k, 0);
      logger.warn(
        { providerId, model, count, threshold: this.midStreamFailureThreshold, cooldownMs, escalation: escalation + 1 },
        `Provider ${providerId}/${model} mid-stream failures (${count}) exceeded threshold, applying ${cooldownMs}ms cooldown (escalation #${escalation + 1})`,
      );
    } else {
      logger.debug(
        { providerId, model, count, threshold: this.midStreamFailureThreshold },
        `Provider ${providerId}/${model} mid-stream failure ${count}/${this.midStreamFailureThreshold}`,
      );
    }
  }

  /**
   * Reset mid-stream failure counter for a provider+model pair.
   * Called on successful stream completion.
   * @param providerId - Provider instance ID.
   * @param model - Model ID.
   */
  resetMidStreamFailures(providerId: string, model: string): void {
    const k = this.key(providerId, model);
    const hadFailures = this.midStreamFailures.has(k);
    const hadEscalation = this.midStreamEscalation.has(k);
    this.midStreamFailures.delete(k);
    this.midStreamEscalation.delete(k);

    if (hadFailures || hadEscalation) {
      logger.debug(
        { providerId, model },
        `Provider ${providerId}/${model} mid-stream failure counter and escalation reset`,
      );
    }
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
