import { dequal } from 'dequal/lite';
import type { SWREntry, SWRListener, SWRPending, SWRResult } from './cache/mutation-cache';
import type { SWRMutateOptions, SWRMutateValue } from './types';
import {
  MUTATION_CACHE,
  getMutation,
  setMutation,
  subscribeMutation,
} from './cache/mutation-cache';
import { setRevalidation } from './cache/revalidation-cache';
import { cancelFetch } from './fetches';
import IS_CLIENT from './is-client';

/**
 * Asks the subscribed stores for `key` to revalidate. Fresh entries are not
 * fetched again.
 */
export function trigger(key: string): void {
  if (!IS_CLIENT) {
    return;
  }
  setRevalidation(key, false);
}

// oxlint-disable-next-line typescript/promise-function-async
function toPromise<T>(result: SWRResult<T>): Promise<T> {
  if (result.status === 'pending') {
    return result.data;
  }
  if (result.status === 'success') {
    return Promise.resolve(result.data);
  }
  // oxlint-disable-next-line typescript/prefer-promise-reject-errors
  const rejected = Promise.reject<T>(result.data);
  rejected.catch(() => undefined);
  return rejected;
}

// A written pending result is replaced by its outcome, unless something else
// was written first. Without this, the entry stays pending when no store
// fetches the key, and whoever waits on it waits forever. The written entry
// is compared by identity, so a write made by a listener during the
// notification also counts as newer.
function settlePending<T>(key: string, written: SWREntry<T>, result: SWRPending<T>): void {
  const settle = (outcome: SWRResult<T>): void => {
    if (getMutation<T>(key) === written) {
      setMutation(key, { result: outcome, timestamp: Date.now(), isValidating: false });
    }
  };
  result.data.then(
    (value) => {
      settle({ data: value, status: 'success' });
    },
    (error: unknown) => {
      settle({ data: error, status: 'failure' });
    },
  );
}

/**
 * Writes `result` to the cache entry for `key` and notifies subscribers. With
 * `revalidate`, the subscribed stores then fetch again, even when the entry is
 * fresh, so the fetched data replaces the written one.
 */
export function setResult<T>(
  key: string,
  result: SWRResult<T>,
  { revalidate = true, compare = dequal }: SWRMutateOptions<T> = {},
): void {
  // The server has no cache to write to.
  if (!IS_CLIENT) {
    return;
  }
  const current = getMutation<T>(key);
  const timestamp = Date.now();

  // A running fetch started before this write, so its result would be
  // dropped. It stops now, and its promise settles with the written result.
  cancelFetch(key, toPromise(result));

  if (
    current?.result.status === 'success' &&
    result.status === 'success' &&
    compare(current.result.data, result.data)
  ) {
    // Same data, so only the age resets and subscribers are not notified.
    // A fetch that is still running started before this write, so the entry
    // is no longer waiting on it. Subscribers only hear about it when
    // `isValidating` changes.
    setMutation(key, { ...current, timestamp, isValidating: false }, current.isValidating);
  } else {
    const written: SWREntry<T> = { result, timestamp, isValidating: false };
    setMutation(key, written);
    if (result.status === 'pending') {
      settlePending(key, written, result);
    }
  }

  // Revalidate after the write. A fetch that starts now is newer than the
  // written data, so its result is kept.
  if (revalidate) {
    setRevalidation(key, true);
  }
}

/**
 * Writes successful data to the cache entry for `key`. `value` can be a
 * function, which receives the cached data, or `undefined` when the entry
 * holds no data. Data that is itself a function has to go through
 * `setResult`.
 */
export function mutate<T>(
  key: string,
  value: SWRMutateValue<T>,
  options?: SWRMutateOptions<T>,
): void {
  // The server has no cache, so an updater has nothing to read.
  if (!IS_CLIENT) {
    return;
  }
  let data: T;
  if (typeof value === 'function') {
    const current = getMutation<T>(key)?.result;
    // A function value is always an updater, as documented.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    data = (value as (previous: T | undefined) => T)(
      current?.status === 'success' ? current.data : undefined,
    );
  } else {
    data = value;
  }
  setResult(key, { data, status: 'success' }, options);
}

export function subscribe<T>(key: string, listener: SWRListener<T>): () => void {
  const wrappedListener: SWRListener<T> = (value) => {
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
