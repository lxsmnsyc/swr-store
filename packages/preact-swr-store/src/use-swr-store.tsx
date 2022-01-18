import { useDebugValue } from 'preact/hooks';
import { SWRStore, MutationResult } from 'swr-store';
import {
  useConditionalMemo,
} from '@lyonph/preact-hooks';
import {
  createStoreAdapter,
  StoreAdapter,
  useStoreAdapter,
} from 'preact-store-adapter';

function compareArray<T extends any[] = []>(
  prev: T, next: T,
): boolean {
  if (prev === next) {
    return false;
  }
  if (prev.length !== next.length) {
    return true;
  }
  for (let i = 0; i < prev.length; i += 1) {
    if (!Object.is(prev[i], next[i])) {
      return true;
    }
  }
  return false;
}

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
  const sub = useConditionalMemo(
    (): StoreAdapter<MutationResult<T>> => createStoreAdapter({
      read: () => store.get(args, {
        shouldRevalidate,
        initialData,
      }),
      subscribe: (callback) => store.subscribe(args, callback),
    }),
    [store, initialData, shouldRevalidate, ...args],
    compareArray,
  );

  const value = useStoreAdapter(sub);

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
