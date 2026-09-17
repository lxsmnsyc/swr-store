import type { MutationListener, MutationResult } from './cache/mutation-cache';

export type SWRCompare<T> = (a: T, b: T) => boolean;

export type SWRTrigger<P extends any[] = []> = (args: P, shouldRevalidate?: boolean) => void;

export type SWRMutate<T, P extends any[] = []> = (
  args: P,
  data: MutationResult<T>,
  shouldRevalidate?: boolean,
  compare?: SWRCompare<T>,
) => void;

export interface SWRGetOptions<T> {
  shouldRevalidate?: boolean;
  initialData?: T;
  hydrate?: boolean;
}

export type SWRGet<T, P extends any[] = []> = (
  args: P,
  options?: SWRGetOptions<T>,
) => MutationResult<T>;

export type SWRSubscribe<T, P extends any[] = []> = (
  args: P,
  listener: MutationListener<T>,
) => () => void;

export interface SWRStoreBaseOptions<T, P extends any[] = []> {
  get: (...args: P) => Promise<T>;
  /**
   * Returns the cache key for the arguments. Build it from what makes the
   * data unique, such as an id. Stores that return the same key share the
   * same cache entry.
   */
  key: (...args: P) => string;
  initialData?: T;
  refreshInterval?: number;
  maxRetryCount?: number;
}

export interface SWRStoreExtendedOptions<T> {
  revalidateOnFocus: boolean;
  revalidateOnVisibility: boolean;
  revalidateOnNetwork: boolean;

  refreshWhenOffline: boolean;
  refreshWhenHidden: boolean;
  refreshWhenBlurred: boolean;

  freshAge: number;
  staleAge: number;

  compare: SWRCompare<T>;

  maxRetryInterval: number;
}

export type SWRStorePartialOptions<T> = Partial<SWRStoreExtendedOptions<T>>;

export interface SWRStoreOptions<T, P extends any[] = []>
  extends SWRStorePartialOptions<T>, SWRStoreBaseOptions<T, P> {}

export interface SWRFullOptions<T, P extends any[] = []>
  extends SWRStoreExtendedOptions<T>, SWRStoreBaseOptions<T, P> {}

export interface SWRStore<T, P extends any[] = []> {
  id: string;
  /** Returns the cache key for `args`, for use with the global functions. */
  getKey: (args: P) => string;
  trigger: SWRTrigger<P>;
  mutate: SWRMutate<T, P>;
  get: SWRGet<T, P>;
  subscribe: SWRSubscribe<T, P>;
}
