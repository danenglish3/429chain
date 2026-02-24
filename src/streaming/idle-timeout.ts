/**
 * Resettable idle timeout for streaming responses.
 * Rejects when no data arrives within the configured interval.
 */

export interface IdleTimeout {
  /** Promise that rejects with the provided error on timeout. Never resolves. */
  promise: Promise<never>;
  /** Reset the idle timer (call on each chunk received). */
  reset(): void;
  /** Clear the timer to prevent leaks (call in finally). */
  clear(): void;
}

export function createIdleTimeout(timeoutMs: number, error: Error): IdleTimeout {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let reject: ((err: Error) => void) | null = null;

  const promise = new Promise<never>((_resolve, _reject) => {
    reject = _reject;
    timer = setTimeout(() => _reject(error), timeoutMs);
  });

  return {
    promise,
    reset() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = setTimeout(() => reject?.(error), timeoutMs);
      }
    },
    clear() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
