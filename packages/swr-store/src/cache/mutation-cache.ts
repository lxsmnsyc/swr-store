import {
  addReactiveCacheListener,
  createReactiveCache,
  getReactiveCacheListenerSize,
  ReactiveCacheListener,
  removeReactiveCacheListener,
  setReactiveCacheValue,
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
export type MutationResult<T> =
  | MutationPending<T>
  | MutationSuccess<T>
  | MutationFailure;

export interface Mutation<T> {
  result: MutationResult<T>;
  timestamp: number;
}

export const MUTATION_CACHE = createReactiveCache<Mutation<any>>();

export type MutationListener<T> = ReactiveCacheListener<Mutation<T>>;

export function addMutationListener<T>(
  key: string,
  listener: MutationListener<T>,
): void {
  addReactiveCacheListener(MUTATION_CACHE, key, listener);
}

export function removeMutationListener<T>(
  key: string,
  listener: MutationListener<T>,
): void {
  removeReactiveCacheListener(MUTATION_CACHE, key, listener);
}

export function setMutation<T>(
  key: string,
  value: Mutation<T>,
): void {
  setReactiveCacheValue(MUTATION_CACHE, key, value);
}

export function getMutation<T>(
  key: string,
): Mutation<T> | undefined {
  return MUTATION_CACHE.cache.get(key)?.value;
}

export function getMutationListenerSize(
  key: string,
): number {
  return getReactiveCacheListenerSize(MUTATION_CACHE, key);
}
