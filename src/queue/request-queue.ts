/**
 * RequestQueue — FIFO deferred-Promise queue per chain.
 *
 * Requests that arrive when all providers are exhausted are held here.
 * When a chain's cooldown clears, drainOne (or drainChains) is called to
 * attempt execution.  Each item carries a settled flag to prevent
 * double-resolve/reject races between timeout and drain.
 */

import { logger } from '../shared/logger.js';
import { AllProvidersExhaustedError, QueueTimeoutError, QueueFullError } from '../shared/errors.js';
import type { QueueItem, QueueStats } from './types.js';

export class RequestQueue {
  private queues = new Map<string, QueueItem[]>();

  constructor(private readonly maxSize: number = 100) {}

  /**
   * Add a request to the queue for `chainName`.
   *
   * Returns a Promise that resolves/rejects when the item is eventually
   * drained (or times out, or the queue is full).
   */
  enqueue(chainName: string, execute: () => Promise<unknown>, maxWaitMs: number): Promise<unknown> {
    const queue = this.queues.get(chainName) ?? [];

    if (queue.length >= this.maxSize) {
      return Promise.reject(new QueueFullError(chainName, this.maxSize));
    }

    return new Promise((resolve, reject) => {
      const item: QueueItem = {
        chainName,
        execute,
        resolve: (result) => {
          if (!item.settled) {
            item.settled = true;
            clearTimeout(item.timeoutHandle);
            resolve(result);
          }
        },
        reject: (error) => {
          if (!item.settled) {
            item.settled = true;
            clearTimeout(item.timeoutHandle);
            reject(error);
          }
        },
        enqueuedAt: Date.now(),
        // Placeholder — overwritten below after item is created
        timeoutHandle: undefined as unknown as NodeJS.Timeout,
        settled: false,
      };

      item.timeoutHandle = setTimeout(() => {
        item.reject(new QueueTimeoutError(chainName, maxWaitMs));
        this.removeItem(chainName, item);
      }, maxWaitMs);

      // Unref so the timeout does not prevent clean process exit
      if (
        typeof item.timeoutHandle === 'object' &&
        item.timeoutHandle !== null &&
        'unref' in item.timeoutHandle
      ) {
        (item.timeoutHandle as NodeJS.Timeout & { unref(): void }).unref();
      }

      queue.push(item);
      this.queues.set(chainName, queue);

      logger.debug(
        { chainName, depth: queue.length },
        `Request queued for chain "${chainName}" (depth: ${queue.length})`,
      );
    });
  }

  /**
   * Attempt to execute the next item in the queue for `chainName`.
   *
   * - If execute() succeeds → resolve the item's Promise, then attempt the next.
   * - If execute() throws AllProvidersExhaustedError → stop (still exhausted).
   * - If execute() throws anything else → reject this item, attempt the next.
   */
  async drainOne(chainName: string): Promise<void> {
    const queue = this.queues.get(chainName);
    if (!queue || queue.length === 0) return;

    // Skip already-settled items (timed out or client disconnected)
    while (queue.length > 0 && queue[0].settled) {
      queue.shift();
    }
    if (queue.length === 0) return;

    const item = queue[0];

    try {
      const result = await item.execute();
      queue.shift();
      item.resolve(result);
      // Schedule next drain via microtask to avoid synchronous recursion
      if (queue.length > 0) {
        queueMicrotask(() => void this.drainOne(chainName));
      }
    } catch (error) {
      if (error instanceof AllProvidersExhaustedError) {
        // Chain is still rate-limited — leave item in queue, stop draining
        return;
      }
      // Any other error: fail this item, move on to the next
      queue.shift();
      item.reject(error instanceof Error ? error : new Error(String(error)));
      if (queue.length > 0) {
        queueMicrotask(() => void this.drainOne(chainName));
      }
    }
  }

  /**
   * Drain one item from each of the supplied chain names.
   * Called when a cooldown timer fires and we need to try multiple chains.
   */
  drainChains(chainNames: string[]): void {
    for (const name of chainNames) {
      void this.drainOne(name);
    }
  }

  /**
   * Return per-chain queue statistics (only chains that have items).
   */
  getStats(): QueueStats[] {
    const now = Date.now();
    return [...this.queues.entries()]
      .filter(([, q]) => q.length > 0)
      .map(([chainName, q]) => ({
        chainName,
        depth: q.length,
        oldestItemAgeMs: q[0] ? now - q[0].enqueuedAt : null,
      }));
  }

  /**
   * Reject every queued item with the given error and clear all queues.
   * Called during graceful shutdown.
   */
  rejectAll(error: Error): void {
    for (const [, queue] of this.queues) {
      for (const item of queue) {
        item.reject(error);
      }
    }
    this.queues.clear();
  }

  private removeItem(chainName: string, item: QueueItem): void {
    const queue = this.queues.get(chainName);
    if (!queue) return;
    const idx = queue.indexOf(item);
    if (idx !== -1) queue.splice(idx, 1);
  }
}
