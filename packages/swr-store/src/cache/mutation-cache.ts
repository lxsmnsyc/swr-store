import type { ReactiveCacheListener } from './reactive-cache';
import {
  createReactiveCache,
  getReactiveCacheListenerSize,
  getReactiveCacheValue,
  notifyReactiveCache,
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

export function setMutation<T>(key: string, value: Mutation<T>, notify = true): void {
  setReactiveCacheValue(MUTATION_CACHE, key, value, notify);
}

const scheduled = new Set<string>();

// Writes now and notifies subscribers in a microtask. Reads can write to the
// cache while a UI library is rendering, and notifying right away would make
// other components update in the middle of that render.
export function setMutationDeferred<T>(key: string, value: Mutation<T>): void {
  setMutation(key, value, false);
  if (scheduled.has(key)) {
    return;
  }
  scheduled.add(key);
  queueMicrotask(() => {
    scheduled.delete(key);
    notifyReactiveCache(MUTATION_CACHE, key);
  });
}

// Promises that a suspended component is waiting on.
export const AWAITED_PROMISES = new WeakSet<Promise<unknown>>();

// Entries written by a fetch that a suspended component waited on, and that
// no read has returned yet. The next read returns them without revalidating,
// so the component gets the data it waited for even when the entry is already
// expired.
export const UNREAD_MUTATIONS = new WeakSet<Mutation<unknown>>();

export function getMutation<T>(key: string): Mutation<T> | undefined {
  return getReactiveCacheValue(MUTATION_CACHE, key);
}

export function getMutationListenerSize(key: string): number {
  return getReactiveCacheListenerSize(MUTATION_CACHE, key);
}
