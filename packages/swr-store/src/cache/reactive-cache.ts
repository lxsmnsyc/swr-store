import IS_CLIENT from '../is-client';
import LRUMap from './lru-map';

export const DEFAULT_CACHE_SIZE = 1000;

export type ReactiveCacheListener<T> = (value: T) => void;
export interface ReactiveCacheRef<T> {
  value: T;
}

export interface ReactiveCache<T> {
  cache: LRUMap<string, ReactiveCacheRef<T>>;
  subscribers: Map<string, Set<ReactiveCacheListener<T>>>;
}

export function createReactiveCache<T>(maxSize = DEFAULT_CACHE_SIZE): ReactiveCache<T> {
  const subscribers = new Map<string, Set<ReactiveCacheListener<T>>>();
  return {
    // Entries with subscribers stay, so subscribers never hold a value that
    // is no longer in the cache.
    cache: new LRUMap(maxSize, (key) => !subscribers.has(key)),
    subscribers,
  };
}

// The cache is shared by everything in the same JS runtime. On a server, that
// means every request, so values are never stored or broadcast there. This
// keeps one request from reading another request's data.
export function getReactiveCacheValue<T>(cache: ReactiveCache<T>, key: string): T | undefined {
  if (!IS_CLIENT) {
    return undefined;
  }
  return cache.cache.get(key)?.value;
}

export function subscribeReactiveCache<T>(
  cache: ReactiveCache<T>,
  key: string,
  listener: ReactiveCacheListener<T>,
): () => void {
  if (!IS_CLIENT) {
    return () => {
      // Nothing is ever broadcast on the server.
    };
  }
  let subscribers = cache.subscribers.get(key);
  if (!subscribers) {
    subscribers = new Set();
    cache.subscribers.set(key, subscribers);
  }
  subscribers.add(listener);

  return () => {
    subscribers.delete(listener);
    // Drop the empty set so unused keys do not pile up.
    if (subscribers.size === 0 && cache.subscribers.get(key) === subscribers) {
      cache.subscribers.delete(key);
    }
  };
}

export function setReactiveCacheValue<T>(
  cache: ReactiveCache<T>,
  key: string,
  value: T,
  notify = true,
): void {
  if (!IS_CLIENT) {
    return;
  }
  const currentRef = cache.cache.get(key);
  if (currentRef) {
    currentRef.value = value;
  } else {
    cache.cache.set(key, { value });
  }

  if (notify) {
    const subscribers = cache.subscribers.get(key);
    if (subscribers) {
      // Copy first, so a listener that unsubscribes does not skip another.
      for (const listener of Array.from(subscribers)) {
        listener(value);
      }
    }
  }
}

// Calls the listeners of `key` with its current value.
export function notifyReactiveCache<T>(cache: ReactiveCache<T>, key: string): void {
  const ref = cache.cache.peek(key);
  const subscribers = cache.subscribers.get(key);
  if (ref && subscribers) {
    for (const listener of Array.from(subscribers)) {
      listener(ref.value);
    }
  }
}

export function getReactiveCacheListenerSize<T>(cache: ReactiveCache<T>, key: string): number {
  return cache.subscribers.get(key)?.size ?? 0;
}
