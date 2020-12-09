import { useDebugValue } from 'react';
import { SWRStore, MutationResult } from 'swr-store';
import {
  createExternalSubject,
  useExternalSubject,
  ExternalSubject,
} from 'react-external-subject';
import {
  useDisposableMemo,
} from 'use-dispose';

interface BaseOptions<T> {
  initialData?: T;
  shouldRevalidate?: boolean;
}

interface WithSuspenseOptions<T> extends BaseOptions<T> {
  suspense: true;
}
interface WithoutSuspenseOptions<T> extends BaseOptions<T> {
  suspense: false;
}

export type UseSWRStoreOptions<T> =
  | WithSuspenseOptions<T>
  | WithoutSuspenseOptions<T>;

function useSWRStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: P,
  options?: WithoutSuspenseOptions<T>,
): MutationResult<T>;
function useSWRStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: P,
  options?: WithSuspenseOptions<T>,
): T;
function useSWRStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: P,
  { suspense, initialData, shouldRevalidate }: UseSWRStoreOptions<T> = {
    suspense: false,
  },
): MutationResult<T> | T {
  const sub = useDisposableMemo(
    (): ExternalSubject<MutationResult<T>> => createExternalSubject({
      read: () => store.get(args, {
        shouldRevalidate,
        initialData,
      }),
      subscribe: (callback) => store.subscribe(args, callback),
      // shouldUpdate: (next, prev) => {
      //   if (prev.status === next.status) {
      //     return !Object.is(next.data, prev.data);
      //   }
      //   return true;
      // },
    }),
    (instance) => instance.destroy(),
    [store, initialData, shouldRevalidate, ...args],
  );

  const value = useExternalSubject(sub, false);

  useDebugValue(suspense && value.status === 'success' ? value.data : value);

  if (suspense) {
    if (value.status === 'success') {
      return value.data;
    }
    throw value.data;
  }
  return value;
}

export default useSWRStore;
