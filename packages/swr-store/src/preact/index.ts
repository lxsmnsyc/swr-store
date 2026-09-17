import { useSyncExternalStore } from 'preact/compat';
import { useDebugValue, useEffect, useState } from 'preact/hooks';
import type { SWRResult } from '../cache/mutation-cache';
import type { ExternalStore } from '../bindings/external-store';
import { SERVER_SUSPENSE_ERROR, createExternalStore } from '../bindings/external-store';
import IS_CLIENT from '../is-client';
import type { SWRStore } from '../types';

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

  const [source, setSource] = useState(createSource);

  let current = source;
  if (current.store !== store || current.key !== key || current.revalidate !== revalidate) {
    current = createSource();
    setSource(current);
  }

  // Preact's `useSyncExternalStore` takes no server snapshot.
  const value = useSyncExternalStore(current.external.subscribe, current.external.read);

  useEffect(() => {
    current.external.setArgs(args);
  });

  useEffect(() => {
    current.external.revalidate();
  }, [current]);

  useDebugValue(value);

  if (suspense) {
    // A cached failure is revalidated first. The component never mounts
    // while it throws, so the revalidation after mounting would never run,
    // and resetting an error boundary would show the same error forever.
    const shown = value.status === 'failure' ? current.external.retryFailure() : value;
    if (shown.status === 'success') {
      return shown.data;
    }
    if (shown.status === 'failure') {
      throw shown.data;
    }
    // The server has no cache, so the read after suspending would start a
    // new fetch and suspend again, forever. Fail instead, which makes the
    // nearest Suspense boundary render on the client.
    if (!IS_CLIENT) {
      throw new Error(SERVER_SUSPENSE_ERROR);
    }
    // Suspense works by throwing the promise to wait on.
    // oxlint-disable-next-line typescript/only-throw-error
    throw current.external.wait(shown);
  }
  return value;
}
