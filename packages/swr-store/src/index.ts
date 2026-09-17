export { mutate, setCacheSize, subscribe, trigger } from './global';
export { default as createSWRStore } from './create-swr-store';
export type * from './types';
export type {
  Mutation,
  MutationListener,
  MutationPending,
  MutationSuccess,
  MutationFailure,
  MutationResult,
} from './cache/mutation-cache';
