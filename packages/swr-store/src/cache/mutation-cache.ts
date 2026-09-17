import type { ReactiveCacheListener } from './reactive-cache';
import {
  createReactiveCache,
  getReactiveCacheListenerSize,
  getReactiveCacheValue,
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

export function getMutation<T>(key: string): Mutation<T> | undefined {
  return getReactiveCacheValue(MUTATION_CACHE, key);
}

export function getMutationListenerSize(key: string): number {
  return getReactiveCacheListenerSize(MUTATION_CACHE, key);
}
