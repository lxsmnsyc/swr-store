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
  key: string,
  listener: RevalidationListener,
): void {
  addReactiveCacheListener(REVALIDATION_CACHE, key, listener);
}

export function removeRevalidationListener(
  key: string,
  listener: RevalidationListener,
): void {
  removeReactiveCacheListener(REVALIDATION_CACHE, key, listener);
}

export function setRevalidation(
  key: string,
  value: boolean,
  notify = true,
): void {
  setReactiveCacheValue(REVALIDATION_CACHE, key, value, notify);
}

export function getRevalidation(
  key: string,
): boolean | undefined {
  return REVALIDATION_CACHE.cache.get(key)?.value;
}
