import { dequal } from 'dequal/lite';
import type { SWRStoreExtendedOptions } from './types';

function defaultKey(...args: unknown[]): string {
  return JSON.stringify(args);
}

export default function getDefaultConfig<T, P extends any[]>(): SWRStoreExtendedOptions<T, P> {
  return {
    revalidateOnFocus: false,
    revalidateOnNetwork: false,
    revalidateOnVisibility: false,
    refreshWhenHidden: false,
    refreshWhenBlurred: false,
    refreshWhenOffline: false,
    freshAge: 2000,
    staleAge: 30000,
    key: defaultKey,
    compare: dequal,
    maxRetryInterval: 5000,
  };
}
