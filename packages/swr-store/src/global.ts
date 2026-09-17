import { dequal } from 'dequal/lite';
import type { MutationListener, MutationResult } from './cache/mutation-cache';
import {
  MUTATION_CACHE,
  getMutation,
  setMutation,
  subscribeMutation,
} from './cache/mutation-cache';
import { setRevalidation } from './cache/revalidation-cache';

/**
 * Asks the subscribed stores for `key` to revalidate. Fresh entries are not
 * fetched again.
 */
export function trigger(key: string, shouldRevalidate = true): void {
  if (shouldRevalidate) {
    setRevalidation(key, false);
  }
}

/**
 * Writes `data` to the cache entry for `key` and notifies subscribers. With
 * `shouldRevalidate`, the subscribed stores then fetch again, even when the
 * entry is fresh, so the fetched data replaces the written one.
 */
export function mutate<T>(
  key: string,
  data: MutationResult<T>,
  shouldRevalidate = true,
  compare: (a: T, b: T) => boolean = dequal,
): void {
  const current = getMutation<T>(key);
  const timestamp = Date.now();

  if (
    current?.result.status === 'success' &&
    data.status === 'success' &&
    compare(current.result.data, data.data)
  ) {
    // Same data, so only the age resets and subscribers are not notified.
    // A fetch that is still running started before this write, so the entry
    // is no longer waiting on it. Subscribers only hear about it when
    // `isValidating` changes.
    setMutation(key, { ...current, timestamp, isValidating: false }, current.isValidating);
  } else {
    setMutation(key, {
      result: data,
      timestamp,
      isValidating: false,
    });
  }

  // A written pending result is replaced by its outcome, unless something
  // else was written first. Without this, the entry stays pending when no
  // store fetches the key, and whoever waits on it waits forever.
  if (data.status === 'pending') {
    const written = getMutation<T>(key);
    const settle = (result: MutationResult<T>): void => {
      if (written && getMutation<T>(key) === written) {
        setMutation(key, { result, timestamp: Date.now(), isValidating: false });
      }
    };
    data.data.then(
      (value) => {
        settle({ data: value, status: 'success' });
      },
      (error: unknown) => {
        settle({ data: error, status: 'failure' });
      },
    );
  }

  // Revalidate after the write. A fetch that starts now is newer than the
  // written data, so its result is kept.
  if (shouldRevalidate) {
    setRevalidation(key, true);
  }
}

export function subscribe<T>(key: string, listener: MutationListener<T>): () => void {
  const wrappedListener: MutationListener<T> = (value) => {
    listener(value);
  };
  return subscribeMutation(key, wrappedListener);
}

/**
 * Sets how many cache entries are kept in the browser. When the cache grows
 * past this size, the least recently used entries are removed. Defaults to
 * 1000.
 */
export function setCacheSize(size: number): void {
  MUTATION_CACHE.cache.maxSize = size;
}
