import {
  addReactiveCacheListener,
  createReactiveCache,
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

export const MUTATION_CACHE = createReactiveCache<MutationResult<any>>();

export type MutationListener<T> = ReactiveCacheListener<MutationResult<T>>;

export function addMutationListener<T>(
  listener: MutationListener<T>,
): void {
  addReactiveCacheListener(MUTATION_CACHE, listener);
}

export function removeMutationListener<T>(
  listener: MutationListener<T>,
): void {
  removeReactiveCacheListener(MUTATION_CACHE, listener);
}

export function setMutation<T>(
  key: string,
  value: MutationResult<T>,
): void {
  setReactiveCacheValue(MUTATION_CACHE, key, value);
}

export function getMutation<T>(
  key: string,
): MutationResult<T> | undefined {
  return MUTATION_CACHE.cache.get(key);
}
