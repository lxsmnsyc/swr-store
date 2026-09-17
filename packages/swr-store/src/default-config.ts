import { dequal } from 'dequal/lite';
import type { SWRStoreOptions } from './types';

type DefaultedOption =
  | 'revalidateOnFocus'
  | 'revalidateOnNetwork'
  | 'revalidateOnVisibility'
  | 'refreshWhenHidden'
  | 'refreshWhenBlurred'
  | 'refreshWhenOffline'
  | 'freshAge'
  | 'staleAge'
  | 'compare'
  | 'maxRetryInterval';

export type SWRDefaults<T> = Required<Pick<SWRStoreOptions<T>, DefaultedOption>>;

// The store options with every default filled in.
export type SWRFullOptions<T, P extends any[] = []> = SWRStoreOptions<T, P> & SWRDefaults<T>;

export default function getDefaultConfig<T>(): SWRDefaults<T> {
  return {
    revalidateOnFocus: false,
    revalidateOnNetwork: false,
    revalidateOnVisibility: false,
    refreshWhenHidden: false,
    refreshWhenBlurred: false,
    refreshWhenOffline: false,
    freshAge: 2000,
    staleAge: 30000,
    compare: dequal,
    maxRetryInterval: 5000,
  };
}
