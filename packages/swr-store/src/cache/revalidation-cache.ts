import {
  addReactiveCacheListener,
  createReactiveCache,
  ReactiveCacheListener,
  removeReactiveCacheListener,
  setReactiveCacheValue,
} from './reactive-cache';

export const REVALIDATION_CACHE = createReactiveCache<boolean>();

export type RevalidationListener = ReactiveCacheListener<boolean>;

export function addRevalidationListener(
  listener: RevalidationListener,
): void {
  addReactiveCacheListener(REVALIDATION_CACHE, listener);
}

export function removeRevalidationListener(
  listener: RevalidationListener,
): void {
  removeReactiveCacheListener(REVALIDATION_CACHE, listener);
}

export function setRevalidation(
  key: string,
  value: boolean,
): void {
  setReactiveCacheValue(REVALIDATION_CACHE, key, value);
}

export function getRevalidation(
  key: string,
): boolean | undefined {
  return REVALIDATION_CACHE.cache.get(key);
}
