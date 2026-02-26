/**
 * Type definitions for the RequestQueue.
 */

/** A single item waiting in the queue for a given chain. */
export interface QueueItem {
  /** The chain this item belongs to. */
  chainName: string;
  /** The function to call when draining this item. */
  execute: () => Promise<unknown>;
  /** Resolve the deferred Promise with a result. */
  resolve: (result: unknown) => void;
  /** Reject the deferred Promise with an error. */
  reject: (error: Error) => void;
  /** Unix epoch ms when the item was enqueued. */
  enqueuedAt: number;
  /** Timeout handle for the maxWaitMs expiry. */
  timeoutHandle: NodeJS.Timeout;
  /** True once the item has been resolved or rejected — prevents double-settle. */
  settled: boolean;
}

/** Statistics for a single chain's queue. */
export interface QueueStats {
  /** The chain name. */
  chainName: string;
  /** Number of items currently waiting. */
  depth: number;
  /** Age of the oldest item in milliseconds, or null if queue is empty. */
  oldestItemAgeMs: number | null;
}
