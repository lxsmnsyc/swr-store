import { dequal } from 'dequal/lite';
import type { SWRStoreExtendedOptions } from './types';

export default function getDefaultConfig<T>(): SWRStoreExtendedOptions<T> {
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
