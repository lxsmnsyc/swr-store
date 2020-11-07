import { useDebugValue } from 'react';
import { SWRStore, MutationResult } from 'swr-store';
import { compareArray } from './hooks/useFreshLazyRef';
import useMemoCondition from './hooks/useMemoCondition';
import useSubscription, { Subscription } from './hooks/useSubscription';

function useSWRStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: P,
  suspense: true,
): T;
function useSWRStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: P,
  suspense: false,
): MutationResult<T>;
function useSWRStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: P,
  suspense = false,
): MutationResult<T> | T {
  const sub = useMemoCondition(
    (): Subscription<MutationResult<T>> => ({
      read: () => store.get(...args),
      subscribe: (callback) => store.subscribe(args, callback),
    }),
    [store, ...args],
    compareArray,
  );

  const value = useSubscription(sub);
  useDebugValue(value);

  if (suspense) {
    if (value.status === 'success') {
      return value.data;
    }
    throw value.data;
  }
  return value;
}

export default useSWRStore;
