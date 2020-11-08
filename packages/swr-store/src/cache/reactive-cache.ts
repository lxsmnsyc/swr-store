export type ReactiveCacheListener<T> = (value: T) => void;
export interface ReactiveCacheRef<T> {
  value: T;
}

export interface ReactiveCache<T> {
  cache: Map<string, ReactiveCacheRef<T>>;
  subscribers: Map<string, Set<ReactiveCacheListener<T>>>;
}

export function createReactiveCache<T>(): ReactiveCache<T> {
  return {
    cache: new Map(),
    subscribers: new Map(),
  };
}

export function createReactiveCacheRef<T>(
  cache: ReactiveCache<T>,
  key: string,
  value: T,
): ReactiveCacheRef<T> {
  const currentRef = cache.cache.get(key);
  if (currentRef) {
    return currentRef;
  }
  const newRef: ReactiveCacheRef<T> = {
    value,
  };
  cache.cache.set(key, newRef);
  return newRef;
}

export function addReactiveCacheListener<T>(
  cache: ReactiveCache<T>,
  key: string,
  listener: ReactiveCacheListener<T>,
): void {
  let subscribers = cache.subscribers.get(key);
  if (!subscribers) {
    subscribers = new Set();
    cache.subscribers.set(key, subscribers);
  }
  subscribers.add(listener);
}

export function removeReactiveCacheListener<T>(
  cache: ReactiveCache<T>,
  key: string,
  listener: ReactiveCacheListener<T>,
): void {
  const subscribers = cache.subscribers.get(key);
  if (subscribers) {
    subscribers.delete(listener);
  }
}

export function setReactiveCacheValue<T>(
  cache: ReactiveCache<T>,
  key: string,
  value: T,
  notify = true,
): void {
  const currentRef = createReactiveCacheRef(cache, key, value);
  currentRef.value = value;

  if (notify) {
    let subscribers = cache.subscribers.get(key);
    if (!subscribers) {
      subscribers = new Set();
      cache.subscribers.set(key, subscribers);
    }
    subscribers.forEach((listener) => {
      listener(value);
    });
  }
}

export function getReactiveCacheListenerSize<T>(
  cache: ReactiveCache<T>,
  key: string,
): number {
  return cache.subscribers.get(key)?.size ?? 0;
}
