/**
 * Cooldown timer management.
 * Manages setTimeout-based timers for automatic rate limit recovery.
 * Each timer is keyed by a composite providerId:model string.
 */

/**
 * Manages cooldown timers for rate limit auto-recovery.
 * When a provider+model is marked exhausted, a timer is scheduled
 * to automatically mark it available again after the cooldown expires.
 */
export class CooldownManager {
  private timers = new Map<string, NodeJS.Timeout>();

  /**
   * Schedule a cooldown timer. If a timer already exists for this key,
   * it is cancelled and replaced with the new one.
   * @param key - Composite key (e.g., "providerId:model").
   * @param durationMs - Cooldown duration in milliseconds.
   * @param onExpire - Callback to invoke when the cooldown expires.
   */
  schedule(key: string, durationMs: number, onExpire: () => void): void {
    // Cancel any existing timer for this key first
    const existing = this.timers.get(key);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.timers.delete(key);
      onExpire();
    }, durationMs);

    // Unref the timer so it doesn't keep the process alive during shutdown
    if (typeof timer === 'object' && 'unref' in timer) {
      timer.unref();
    }

    this.timers.set(key, timer);
  }

  /**
   * Cancel a specific cooldown timer.
   * @param key - Composite key to cancel.
   */
  cancel(key: string): void {
    const timer = this.timers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  /**
   * Cancel all active cooldown timers.
   * Used during graceful shutdown to prevent dangling timers.
   */
  cancelAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  /** Number of active cooldown timers. */
  get activeCount(): number {
    return this.timers.size;
  }
}
