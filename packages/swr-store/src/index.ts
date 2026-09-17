export { mutate, setCacheSize, setResult, subscribe, trigger } from './global';
export { default as createSWRStore } from './create-swr-store';
export type {
  SWRCompare,
  SWRGetOptions,
  SWRMutateOptions,
  SWRMutateValue,
  SWRStore,
  SWRStoreOptions,
} from './types';
export type {
  SWREntry,
  SWRListener,
  SWRPending,
  SWRSuccess,
  SWRFailure,
  SWRResult,
} from './cache/mutation-cache';
