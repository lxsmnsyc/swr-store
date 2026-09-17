import * as React from 'react';
import type { SWRResult } from '../cache/mutation-cache';
import type { ExternalStore } from '../bindings/external-store';
import { SERVER_SUSPENSE_ERROR, SETTLED, createExternalStore } from '../bindings/external-store';
import IS_CLIENT from '../is-client';
import type { SWRStore } from '../types';

// `use` is how React 19 components suspend on a promise. React 18 does not
// have it, and a named import would fail to load there, so it is read from
// the module instead. Without it, the hook throws the promise, which React
// 18 also supports.
const { use } = React as Partial<Pick<typeof React, 'use'>>;

interface BaseOptions<T> {
  initialData?: T;
  revalidate?: boolean;
  hydrate?: boolean;
}

interface WithSuspenseOptions<T> extends BaseOptions<T> {
  suspense: true;
}

interface WithoutSuspenseOptions<T> extends BaseOptions<T> {
  suspense?: false;
}

export interface UseSWRStoreOptions<T> extends BaseOptions<T> {
  suspense?: boolean;
}

interface Source<T, P extends any[]> {
  store: SWRStore<T, P>;
  key: string;
  revalidate: boolean | undefined;
  external: ExternalStore<T>;
}

export function useSWRStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: P,
  options?: WithoutSuspenseOptions<T>,
): SWRResult<T>;
export function useSWRStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: P,
  options: WithSuspenseOptions<T>,
): T;
export function useSWRStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: P,
  options?: UseSWRStoreOptions<T>,
): SWRResult<T> | T;
export function useSWRStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: P,
  options: UseSWRStoreOptions<T> = {},
): SWRResult<T> | T {
  const { suspense, initialData, revalidate, hydrate } = options;

  // The source is rebuilt when the cache key changes, not when `args` or
  // `initialData` are new objects with the same contents. Initial data only
  // matters for the first read.
  const key = store.getKey(args);
  const createSource = (): Source<T, P> => ({
    store,
    key,
    revalidate,
    external: createExternalStore(store, args, { initialData, revalidate, hydrate }),
  });

  const [source, setSource] = React.useState(createSource);

  let current = source;
  if (current.store !== store || current.key !== key || current.revalidate !== revalidate) {
    current = createSource();
    setSource(current);
  }

  const value = React.useSyncExternalStore(
    current.external.subscribe,
    current.external.read,
    current.external.readServer,
  );

  React.useEffect(() => {
    current.external.setArgs(args);
  });

  React.useEffect(() => {
    current.external.revalidate();
  }, [current]);

  React.useDebugValue(value);

  if (suspense) {
    // A cached failure is revalidated first. The component never mounts
    // while it throws, so the revalidation after mounting would never run,
    // and resetting an error boundary would show the same error forever.
    let shown = value;
    if (shown.status === 'failure') {
      shown = current.external.retryFailure();
    } else if (shown.status === 'pending' && IS_CLIENT) {
      // While hydrating, a pending value is the server's snapshot. Its
      // promise would fetch outside the cache, so the cache is read instead.
      shown = current.external.read();
    }
    if (shown.status === 'pending') {
      // The server has no cache, so the read after suspending would start a
      // new fetch and suspend again, forever. Fail instead, which makes the
      // nearest Suspense boundary render on the client.
      if (!IS_CLIENT) {
        throw new Error(SERVER_SUSPENSE_ERROR);
      }
      if (!use) {
        // React 18 suspends when the promise to wait on is thrown.
        // oxlint-disable-next-line typescript/only-throw-error
        throw current.external.wait(shown);
      }
      use(current.external.wait(shown));
      // A replayed render can get past `use` with the promise of an earlier
      // attempt. The data is read from the cache, which is up to date.
      shown = current.external.read();
      if (shown.status === 'pending') {
        // A newer fetch replaced the one that was waited on.
        use(current.external.wait(shown));
        throw new Error('useSWRStore expected `use` to suspend.');
      }
    } else if (use) {
      // React expects a component that suspended with `use` to call it again
      // when it finishes, so settled results go through `use` too.
      use(SETTLED);
    }
    if (shown.status === 'failure') {
      throw shown.data;
    }
    return shown.data;
  }
  return value;
}
