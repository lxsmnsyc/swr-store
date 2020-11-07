export type ReactiveCacheListener<T> = (value: T) => void;
export interface ReactiveCacheRef<T> {
  value: T;
  listeners: Set<ReactiveCacheListener<T>>;
}

export interface ReactiveCache<T> {
  cache: Map<string, ReactiveCacheRef<T>>;
}

export function createReactiveCache<T>(): ReactiveCache<T> {
  return {
    cache: new Map<string, ReactiveCacheRef<T>>(),
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
    listeners: new Set(),
  };
  cache.cache.set(key, newRef);
  return newRef;
}

export function addReactiveCacheListener<T>(
  cache: ReactiveCache<T>,
  key: string,
  listener: ReactiveCacheListener<T>,
): void {
  const currentRef = cache.cache.get(key);
  if (currentRef) {
    currentRef.listeners.add(listener);
  }
}

export function removeReactiveCacheListener<T>(
  cache: ReactiveCache<T>,
  key: string,
  listener: ReactiveCacheListener<T>,
): void {
  const currentRef = cache.cache.get(key);
  if (currentRef) {
    currentRef.listeners.delete(listener);
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
    currentRef.listeners.forEach((listener) => {
      listener(value);
    });
  }
}

export function getReactiveCacheListenerSize<T>(
  cache: ReactiveCache<T>,
  key: string,
): number {
  return cache.cache.get(key)?.listeners.size ?? 0;
}
