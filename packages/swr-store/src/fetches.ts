import type { SWRPending } from './cache/mutation-cache';
import type { Retry } from './retry';

export interface Fetch<T> {
  retry: Retry<T>;
  // The pending result for readers that have no cache entry to return.
  result: SWRPending<T>;
  startedAt: number;
}

// The running fetch of each key. A key has at most one.
export const fetches = new Map<string, Fetch<any>>();

// Stops the running fetch of `key`, whose result a newer write makes
// useless. Its promise settles with `replacement`, so whoever waits on it
// still gets data. Without this, the fetch would keep retrying and block new
// fetches for the key until it succeeds, only for its result to be dropped.
export function cancelFetch<T>(key: string, replacement: Promise<T>): void {
  const running = fetches.get(key);
  if (running) {
    fetches.delete(key);
    running.retry.cancel(replacement);
  }
}
