import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RequestQueue } from '../request-queue.js';
import { AllProvidersExhaustedError, QueueTimeoutError, QueueFullError } from '../../shared/errors.js';

describe('RequestQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('enqueue / drainOne - happy path', () => {
    it('returns a Promise that resolves when drainOne is called and execute succeeds', async () => {
      const queue = new RequestQueue(100);
      const result = Symbol('result');
      const execute = vi.fn().mockResolvedValue(result);

      const promise = queue.enqueue('chain-a', execute, 30_000);
      await queue.drainOne('chain-a');
      await expect(promise).resolves.toBe(result);
    });
  });

  describe('timeout', () => {
    it('rejects with QueueTimeoutError after maxWaitMs', async () => {
      const queue = new RequestQueue(100);
      const execute = vi.fn().mockResolvedValue('ok');

      const promise = queue.enqueue('chain-a', execute, 5000);

      // Advance time past the timeout
      vi.advanceTimersByTime(5001);

      await expect(promise).rejects.toBeInstanceOf(QueueTimeoutError);
      await expect(promise).rejects.toMatchObject({ chainName: 'chain-a', maxWaitMs: 5000 });
    });
  });

  describe('max size', () => {
    it('rejects with QueueFullError when queue reaches maxSize capacity', async () => {
      const queue = new RequestQueue(2);
      const execute = vi.fn().mockResolvedValue('ok');

      // Fill up the queue
      queue.enqueue('chain-a', execute, 30_000);
      queue.enqueue('chain-a', execute, 30_000);

      // Third enqueue should reject immediately
      await expect(queue.enqueue('chain-a', execute, 30_000)).rejects.toBeInstanceOf(QueueFullError);
      await expect(queue.enqueue('chain-a', execute, 30_000)).rejects.toMatchObject({
        chainName: 'chain-a',
        maxSize: 2,
      });
    });
  });

  describe('FIFO order', () => {
    it('drainOne executes first enqueued item (FIFO order)', async () => {
      const queue = new RequestQueue(100);
      const callOrder: string[] = [];

      const executeA = vi.fn().mockImplementation(async () => {
        callOrder.push('A');
        return 'resultA';
      });
      const executeB = vi.fn().mockImplementation(async () => {
        callOrder.push('B');
        return 'resultB';
      });

      queue.enqueue('chain-a', executeA, 30_000);
      queue.enqueue('chain-a', executeB, 30_000);

      await queue.drainOne('chain-a');

      expect(callOrder[0]).toBe('A');
      expect(executeB).not.toHaveBeenCalled();
    });
  });

  describe('drainOne stops on AllProvidersExhaustedError', () => {
    it('stops draining if execute() throws AllProvidersExhaustedError — item stays in queue', async () => {
      const queue = new RequestQueue(100);
      const exhaustedError = new AllProvidersExhaustedError('chain-a', []);
      const execute = vi.fn().mockRejectedValue(exhaustedError);

      const promise = queue.enqueue('chain-a', execute, 30_000);

      await queue.drainOne('chain-a');

      // Item should still be queued (promise still pending)
      const stats = queue.getStats();
      expect(stats).toHaveLength(1);
      expect(stats[0].depth).toBe(1);

      // Promise should not be settled yet
      let resolved = false;
      let rejected = false;
      promise.then(() => { resolved = true; }).catch(() => { rejected = true; });
      // Flush microtasks
      await Promise.resolve();
      expect(resolved).toBe(false);
      expect(rejected).toBe(false);
    });
  });

  describe('drainOne continues on non-rate-limit error', () => {
    it('rejects failed item and continues to next if execute() throws non-rate-limit error', async () => {
      const queue = new RequestQueue(100);
      const genericError = new Error('generic error');
      const executeA = vi.fn().mockRejectedValue(genericError);
      const executeB = vi.fn().mockResolvedValue('resultB');

      const promiseA = queue.enqueue('chain-a', executeA, 30_000);
      const promiseB = queue.enqueue('chain-a', executeB, 30_000);

      await queue.drainOne('chain-a');

      await expect(promiseA).rejects.toBe(genericError);

      // Give microtask queue time to process the next drain
      await new Promise(resolve => setImmediate(resolve));
      await expect(promiseB).resolves.toBe('resultB');
    });
  });

  describe('settled flag safety', () => {
    it('after timeout fires, a subsequent drain does NOT resolve/reject the timed-out item again', async () => {
      const queue = new RequestQueue(100);
      const execute = vi.fn().mockResolvedValue('result');

      const promise = queue.enqueue('chain-a', execute, 5000);

      // Let the timeout fire — item gets rejected
      vi.advanceTimersByTime(5001);
      await expect(promise).rejects.toBeInstanceOf(QueueTimeoutError);

      // Now drain — the item should be skipped, no double-settle
      await queue.drainOne('chain-a');
      // execute should NOT have been called (item was removed by timeout)
      expect(execute).not.toHaveBeenCalled();
    });

    it('after drain resolves, the timeout callback is a no-op (clearTimeout called)', async () => {
      const queue = new RequestQueue(100);
      const execute = vi.fn().mockResolvedValue('result');

      const promise = queue.enqueue('chain-a', execute, 30_000);
      await queue.drainOne('chain-a');
      await expect(promise).resolves.toBe('result');

      // Advance time — timeout should be cleared, no rejection
      vi.advanceTimersByTime(30_001);

      // Promise should still be resolved (not rejected)
      await expect(promise).resolves.toBe('result');
    });
  });

  describe('drainChains', () => {
    it('calls drainOne for each chain name provided', async () => {
      const queue = new RequestQueue(100);
      const executeA = vi.fn().mockResolvedValue('A');
      const executeB = vi.fn().mockResolvedValue('B');

      const promiseA = queue.enqueue('chain-a', executeA, 30_000);
      const promiseB = queue.enqueue('chain-b', executeB, 30_000);

      queue.drainChains(['chain-a', 'chain-b']);

      await expect(promiseA).resolves.toBe('A');
      await expect(promiseB).resolves.toBe('B');
    });
  });

  describe('getStats', () => {
    it('returns correct depth and oldestItemAgeMs for chains with items, empty array for empty queues', async () => {
      const queue = new RequestQueue(100);
      const execute = vi.fn().mockResolvedValue('ok');

      queue.enqueue('chain-a', execute, 30_000);
      queue.enqueue('chain-a', execute, 30_000);
      queue.enqueue('chain-b', execute, 30_000);

      // Advance time so we can measure age
      vi.advanceTimersByTime(100);

      const stats = queue.getStats();

      expect(stats).toHaveLength(2);

      const chainAStats = stats.find(s => s.chainName === 'chain-a');
      const chainBStats = stats.find(s => s.chainName === 'chain-b');

      expect(chainAStats).toBeDefined();
      expect(chainAStats!.depth).toBe(2);
      expect(chainAStats!.oldestItemAgeMs).toBeGreaterThanOrEqual(100);

      expect(chainBStats).toBeDefined();
      expect(chainBStats!.depth).toBe(1);
      expect(chainBStats!.oldestItemAgeMs).toBeGreaterThanOrEqual(100);

      // Empty queue returns nothing
      const emptyStats = new RequestQueue(100).getStats();
      expect(emptyStats).toHaveLength(0);
    });
  });

  describe('rejectAll', () => {
    it('rejects all items in all chains with the provided error, clears all timeouts', async () => {
      const queue = new RequestQueue(100);
      const execute = vi.fn().mockResolvedValue('ok');

      const promiseA1 = queue.enqueue('chain-a', execute, 30_000);
      const promiseA2 = queue.enqueue('chain-a', execute, 30_000);
      const promiseB = queue.enqueue('chain-b', execute, 30_000);

      const shutdownError = new Error('shutdown');
      queue.rejectAll(shutdownError);

      await expect(promiseA1).rejects.toBe(shutdownError);
      await expect(promiseA2).rejects.toBe(shutdownError);
      await expect(promiseB).rejects.toBe(shutdownError);

      // Queue should be empty now
      expect(queue.getStats()).toHaveLength(0);
    });
  });

  describe('client disconnect (pre-settled item)', () => {
    it('if item.settled is true before drain, drainOne skips it', async () => {
      const queue = new RequestQueue(100);
      const execute = vi.fn().mockResolvedValue('result');

      // Enqueue an item, then simulate client disconnect by manually triggering timeout
      const promise = queue.enqueue('chain-a', execute, 1);

      // Fire the timeout immediately
      vi.advanceTimersByTime(2);

      // Item should be rejected (timed out)
      await expect(promise).rejects.toBeInstanceOf(QueueTimeoutError);

      // drainOne should skip the settled (and removed) item
      await queue.drainOne('chain-a');
      expect(execute).not.toHaveBeenCalled();

      // Queue should be empty
      expect(queue.getStats()).toHaveLength(0);
    });
  });
});
