export type ReactiveCacheListener<T> = (value: T) => void;

export interface ReactiveCache<T> {
  cache: Map<string, T>;
  subscribers: Set<ReactiveCacheListener<T>>;
}

export function createReactiveCache<T>(): ReactiveCache<T> {
  return {
    cache: new Map<string, T>(),
    subscribers: new Set(),
  };
}

export function addReactiveCacheListener<T>(
  cache: ReactiveCache<T>,
  listener: ReactiveCacheListener<T>,
): void {
  cache.subscribers.add(listener);
}

export function removeReactiveCacheListener<T>(
  cache: ReactiveCache<T>,
  listener: ReactiveCacheListener<T>,
): void {
  cache.subscribers.delete(listener);
}

export function setReactiveCacheValue<T>(
  cache: ReactiveCache<T>,
  key: string,
  value: T,
  notify = true,
): void {
  cache.cache.set(key, value);

  if (notify) {
    cache.subscribers.forEach((listener) => {
      listener(value);
    });
  }
}
