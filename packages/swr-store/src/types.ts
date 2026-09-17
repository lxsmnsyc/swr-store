import type { SWRListener, SWRResult } from './cache/mutation-cache';

export type SWRCompare<T> = (a: T, b: T) => boolean;

export interface SWRGetOptions<T> {
  /**
   * When `false`, returns the cached result without checking its age. A
   * fetch still starts when there is nothing to show.
   */
  revalidate?: boolean;
  /** Returned while there is no cache entry. */
  initialData?: T;
}

export interface SWRMutateOptions<T> {
  /**
   * When `true`, the subscribed stores fetch again after the write, even when
   * the entry is fresh. Defaults to `true`.
   */
  revalidate?: boolean;
  /** Checks whether the written data equals the cached data. */
  compare?: SWRCompare<T>;
}

/** New data, or a function that returns it from the cached data. */
export type SWRMutateValue<T> = T | ((previous: T | undefined) => T);

export interface SWRStoreOptions<T, P extends any[] = []> {
  get: (...args: P) => Promise<T>;
  /**
   * Returns the cache key for the arguments. Build it from what makes the
   * data unique, such as an id. Stores that return the same key share the
   * same cache entry.
   */
  key: (...args: P) => string;
  initialData?: T;
  refreshInterval?: number;
  maxRetryCount?: number;

  revalidateOnFocus?: boolean;
  revalidateOnVisibility?: boolean;
  revalidateOnNetwork?: boolean;

  refreshWhenOffline?: boolean;
  refreshWhenHidden?: boolean;
  refreshWhenBlurred?: boolean;

  freshAge?: number;
  staleAge?: number;

  compare?: SWRCompare<T>;

  maxRetryInterval?: number;
}

export interface SWRStore<T, P extends any[] = []> {
  /** Returns the cache key for `args`, for use with the global functions. */
  getKey: (args: P) => string;
  /** Reads the cache entry for `args`, and fetches when it is missing or old. */
  get: (args: P, options?: SWRGetOptions<T>) => SWRResult<T>;
  /** Calls `listener` every time the cache entry for `args` is written. */
  subscribe: (args: P, listener: SWRListener<T>) => () => void;
  /** Asks the subscribed stores for the key of `args` to revalidate. */
  trigger: (args: P) => void;
  /** Writes successful data to the cache entry for `args`. */
  mutate: (args: P, value: SWRMutateValue<T>, options?: SWRMutateOptions<T>) => void;
  /** Writes any result, such as a failure, to the cache entry for `args`. */
  setResult: (args: P, result: SWRResult<T>, options?: SWRMutateOptions<T>) => void;
  /**
   * Writes data rendered on the server to the cache entry for `args`. Without
   * `data`, the store `initialData` is written. An existing entry is kept,
   * unless it is still pending on the key's first load.
   */
  hydrate: (args: P, data?: T) => void;
}
