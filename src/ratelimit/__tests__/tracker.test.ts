import { describe, it, expect, afterEach, vi } from 'vitest';
import { RateLimitTracker } from '../tracker.js';

describe('RateLimitTracker', () => {
  let tracker: RateLimitTracker;

  afterEach(() => {
    tracker?.shutdown();
  });

  it('should return false for unknown provider+model', () => {
    tracker = new RateLimitTracker(60_000);
    expect(tracker.isExhausted('unknown', 'model')).toBe(false);
  });

  it('should mark provider+model as exhausted and return true', () => {
    tracker = new RateLimitTracker(60_000);
    tracker.markExhausted('groq', 'llama-3.1-8b', undefined, '429 rate limited');
    expect(tracker.isExhausted('groq', 'llama-3.1-8b')).toBe(true);
  });

  it('should auto-recover after cooldown expires', async () => {
    tracker = new RateLimitTracker(60_000);
    tracker.markExhausted('groq', 'llama-3.1-8b', 100, '429 rate limited');
    expect(tracker.isExhausted('groq', 'llama-3.1-8b')).toBe(true);

    // Wait for cooldown to expire (150ms > 100ms cooldown)
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(tracker.isExhausted('groq', 'llama-3.1-8b')).toBe(false);
  });

  it('should use default cooldown when retryAfterMs is not provided', () => {
    tracker = new RateLimitTracker(5000);
    tracker.markExhausted('openrouter', 'gpt-4');

    const status = tracker.getStatus('openrouter', 'gpt-4');
    expect(status.status).toBe('exhausted');
    expect(status.cooldownUntil).not.toBeNull();
    // Cooldown should be approximately 5 seconds from now
    const now = Date.now();
    expect(status.cooldownUntil!).toBeGreaterThan(now);
    expect(status.cooldownUntil!).toBeLessThanOrEqual(now + 5100);
  });

  it('should replace existing timer on re-exhaustion (not accumulate)', async () => {
    tracker = new RateLimitTracker(60_000);

    // First exhaustion with 200ms cooldown
    tracker.markExhausted('groq', 'llama-3.1-8b', 200, '429');
    const status1 = tracker.getStatus('groq', 'llama-3.1-8b');

    // Wait 50ms and re-exhaust with a fresh 200ms cooldown
    await new Promise((resolve) => setTimeout(resolve, 50));
    tracker.markExhausted('groq', 'llama-3.1-8b', 200, '429 again');
    const status2 = tracker.getStatus('groq', 'llama-3.1-8b');

    // The second cooldownUntil should be later than the first
    expect(status2.cooldownUntil!).toBeGreaterThan(status1.cooldownUntil!);
    expect(status2.reason).toBe('429 again');
  });

  it('should handle race condition: expired cooldown before timer fires', () => {
    tracker = new RateLimitTracker(60_000);

    // Manually set an entry with a cooldownUntil in the past
    // to simulate the timer not having fired yet
    tracker.markExhausted('cerebras', 'llama-3.1-8b', 1, 'test');

    // Force the time check by making Date.now() definitely past cooldownUntil
    // Since we set 1ms cooldown, after any delay it should have expired
    // Use a small delay to ensure the timestamp is past
    const start = Date.now();
    while (Date.now() - start < 5) {
      // busy wait to ensure time passes
    }

    // The isExhausted call should detect the expired cooldown and mark available
    expect(tracker.isExhausted('cerebras', 'llama-3.1-8b')).toBe(false);
    expect(tracker.getStatus('cerebras', 'llama-3.1-8b').status).toBe('available');
  });

  it('should track different models for the same provider independently', () => {
    tracker = new RateLimitTracker(60_000);

    tracker.markExhausted('groq', 'llama-3.1-8b');
    tracker.markExhausted('groq', 'mixtral-8x7b');

    expect(tracker.isExhausted('groq', 'llama-3.1-8b')).toBe(true);
    expect(tracker.isExhausted('groq', 'mixtral-8x7b')).toBe(true);
    expect(tracker.isExhausted('groq', 'llama-3.1-70b')).toBe(false);
  });

  it('should manually mark available and cancel timer', () => {
    tracker = new RateLimitTracker(60_000);

    tracker.markExhausted('groq', 'llama-3.1-8b', 10_000);
    expect(tracker.isExhausted('groq', 'llama-3.1-8b')).toBe(true);

    tracker.markAvailable('groq', 'llama-3.1-8b');
    expect(tracker.isExhausted('groq', 'llama-3.1-8b')).toBe(false);
  });

  it('should return all statuses', () => {
    tracker = new RateLimitTracker(60_000);

    tracker.markExhausted('groq', 'llama-3.1-8b');
    tracker.markExhausted('openrouter', 'gpt-4');
    tracker.markAvailable('openrouter', 'gpt-4');

    const statuses = tracker.getAllStatuses();
    expect(statuses).toHaveLength(2);

    const groqStatus = statuses.find((s) => s.providerId === 'groq');
    expect(groqStatus?.status).toBe('exhausted');

    const orStatus = statuses.find((s) => s.providerId === 'openrouter');
    expect(orStatus?.status).toBe('available');
  });

  it('should return available for unknown provider in getStatus', () => {
    tracker = new RateLimitTracker(60_000);
    const status = tracker.getStatus('unknown', 'model');
    expect(status.status).toBe('available');
    expect(status.cooldownUntil).toBeNull();
  });

  it('should cancel all timers on shutdown', () => {
    tracker = new RateLimitTracker(60_000);

    tracker.markExhausted('a', 'model1', 10_000);
    tracker.markExhausted('b', 'model2', 10_000);
    tracker.markExhausted('c', 'model3', 10_000);

    // Shutdown cancels all timers (no leaked handles)
    tracker.shutdown();

    // State is still exhausted (shutdown doesn't clear state, just timers)
    expect(tracker.isExhausted('a', 'model1')).toBe(true);
  });
});

describe('CooldownManager', () => {
  // CooldownManager is tested indirectly through RateLimitTracker.
  // Direct tests are added here for edge cases.

  it('should import CooldownManager directly', async () => {
    const { CooldownManager } = await import('../cooldown.js');
    const manager = new CooldownManager();

    expect(manager.activeCount).toBe(0);

    let fired = false;
    manager.schedule('test', 50, () => { fired = true; });
    expect(manager.activeCount).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fired).toBe(true);
    expect(manager.activeCount).toBe(0);

    manager.cancelAll();
  });

  it('should replace timer on re-schedule', async () => {
    const { CooldownManager } = await import('../cooldown.js');
    const manager = new CooldownManager();

    let callCount = 0;
    manager.schedule('key', 100, () => { callCount++; });
    manager.schedule('key', 100, () => { callCount++; });

    expect(manager.activeCount).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 150));
    // Only the second timer should have fired
    expect(callCount).toBe(1);

    manager.cancelAll();
  });

  it('should cancel specific timer', async () => {
    const { CooldownManager } = await import('../cooldown.js');
    const manager = new CooldownManager();

    let fired = false;
    manager.schedule('key', 50, () => { fired = true; });
    manager.cancel('key');

    expect(manager.activeCount).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fired).toBe(false);

    manager.cancelAll();
  });
});
