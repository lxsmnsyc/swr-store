import type { ReactiveCacheListener } from './reactive-cache';
import {
  createReactiveCache,
  getReactiveCacheListenerSize,
  getReactiveCacheValue,
  scheduleReactiveCacheNotify,
  setReactiveCacheValue,
  subscribeReactiveCache,
} from './reactive-cache';

export interface MutationPending<T> {
  data: Promise<T>;
  status: 'pending';
}
export interface MutationSuccess<T> {
  data: T;
  status: 'success';
}
export interface MutationFailure {
  data: any;
  status: 'failure';
}
export type MutationResult<T> = MutationPending<T> | MutationSuccess<T> | MutationFailure;

export interface Mutation<T> {
  result: MutationResult<T>;
  timestamp: number;
  isValidating: boolean;
}

export const MUTATION_CACHE = createReactiveCache<Mutation<any>>();

export type MutationListener<T> = ReactiveCacheListener<Mutation<T>>;

export function subscribeMutation<T>(key: string, listener: MutationListener<T>): () => void {
  return subscribeReactiveCache(MUTATION_CACHE, key, listener);
}

let lastVersion = 0;
const VERSIONS = new WeakMap<Mutation<unknown>, number>();

// Every write gets a version that is higher than any version before it. A
// fetch compares versions to tell whether the entry was written after it
// started. Timestamps cannot do that, because two writes can share the same
// millisecond.
export function nextVersion(): number {
  lastVersion += 1;
  return lastVersion;
}

export function getVersion(mutation: Mutation<unknown>): number {
  return VERSIONS.get(mutation) ?? 0;
}

export function setMutation<T>(key: string, value: Mutation<T>, notify = true): void {
  VERSIONS.set(value, nextVersion());
  setReactiveCacheValue(MUTATION_CACHE, key, value, notify);
}

// Writes now and notifies subscribers in a microtask. Reads can write to the
// cache while a UI library is rendering, and notifying right away would make
// other components update in the middle of that render.
export function setMutationDeferred<T>(key: string, value: Mutation<T>): void {
  VERSIONS.set(value, nextVersion());
  setReactiveCacheValue(MUTATION_CACHE, key, value, false);
  scheduleReactiveCacheNotify(MUTATION_CACHE, key);
}

export function getMutation<T>(key: string): Mutation<T> | undefined {
  return getReactiveCacheValue(MUTATION_CACHE, key);
}

export function getMutationListenerSize(key: string): number {
  return getReactiveCacheListenerSize(MUTATION_CACHE, key);
}
