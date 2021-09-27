/**
 * @license
 * MIT License
 *
 * Copyright (c) 2021 Alexis Munsayac
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 *
 * @author Alexis Munsayac <alexis.munsayac@gmail.com>
 * @copyright Alexis Munsayac 2021
 */
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

export function subscribeReactiveCache<T>(
  cache: ReactiveCache<T>,
  key: string,
  listener: ReactiveCacheListener<T>,
): () => void {
  let subscribers = cache.subscribers.get(key);
  if (!subscribers) {
    subscribers = new Set();
    cache.subscribers.set(key, subscribers);
  }
  subscribers.add(listener);

  return () => {
    subscribers?.delete(listener);
  };
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
    for (const listener of subscribers.keys()) {
      listener(value);
    }
  }
}

export function getReactiveCacheListenerSize<T>(
  cache: ReactiveCache<T>,
  key: string,
): number {
  return cache.subscribers.get(key)?.size ?? 0;
}
