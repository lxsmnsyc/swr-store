import type { ReactiveCacheListener } from './reactive-cache';
import {
  createReactiveCache,
  setReactiveCacheValue,
  subscribeReactiveCache,
} from './reactive-cache';

export const REVALIDATION_CACHE = createReactiveCache<boolean>();

export type RevalidationListener = ReactiveCacheListener<boolean>;

export function subscribeRevalidation(key: string, listener: RevalidationListener): () => void {
  return subscribeReactiveCache(REVALIDATION_CACHE, key, listener);
}

export function setRevalidation(key: string, value: boolean, notify = true): void {
  setReactiveCacheValue(REVALIDATION_CACHE, key, value, notify);
}
