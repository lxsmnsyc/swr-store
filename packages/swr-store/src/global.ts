import { dequal } from 'dequal/lite';
import type { MutationListener, MutationResult } from './cache/mutation-cache';
import {
  MUTATION_CACHE,
  getMutation,
  setMutation,
  subscribeMutation,
} from './cache/mutation-cache';
import { setRevalidation } from './cache/revalidation-cache';

export function trigger(key: string, shouldRevalidate = true): void {
  setRevalidation(key, shouldRevalidate);
}

export function mutate<T>(
  key: string,
  data: MutationResult<T>,
  shouldRevalidate = true,
  compare: (a: T, b: T) => boolean = dequal,
): void {
  setRevalidation(key, shouldRevalidate);

  const current = getMutation<T>(key);

  if (
    current?.result.status === 'success' &&
    data.status === 'success' &&
    compare(current.result.data, data.data)
  ) {
    current.timestamp = Date.now();
    return;
  }

  setMutation(key, {
    result: data,
    timestamp: Date.now(),
    isValidating: false,
  });
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
