import type { ReactNode } from 'react';
import { useDebugValue, useEffect, useState, useSyncExternalStore } from 'react';
import type { MutationResult } from '../cache/mutation-cache';
import type { ExternalStore } from '../bindings/external-store';
import { SERVER_SUSPENSE_ERROR, createExternalStore } from '../bindings/external-store';
import IS_CLIENT from '../is-client';
import type { SWRStore } from '../types';

interface BaseOptions<T> {
  initialData?: T;
  shouldRevalidate?: boolean;
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
  shouldRevalidate: boolean | undefined;
  external: ExternalStore<T>;
}

export function useSWRStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: P,
  options?: WithoutSuspenseOptions<T>,
): MutationResult<T>;
export function useSWRStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: P,
  options: WithSuspenseOptions<T>,
): T;
export function useSWRStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: P,
  options?: UseSWRStoreOptions<T>,
): MutationResult<T> | T;
export function useSWRStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: P,
  options: UseSWRStoreOptions<T> = {},
): MutationResult<T> | T {
  const { suspense, initialData, shouldRevalidate, hydrate } = options;

  // The source is rebuilt when the cache key changes, not when `args` or
  // `initialData` are new objects with the same contents. Initial data only
  // matters for the first read.
  const key = store.getKey(args);
  const createSource = (): Source<T, P> => ({
    store,
    key,
    shouldRevalidate,
    external: createExternalStore(store, args, { initialData, shouldRevalidate, hydrate }),
  });

  const [source, setSource] = useState(createSource);

  let current = source;
  if (
    current.store !== store ||
    current.key !== key ||
    current.shouldRevalidate !== shouldRevalidate
  ) {
    current = createSource();
    setSource(current);
  }

  const value = useSyncExternalStore(
    current.external.subscribe,
    current.external.read,
    current.external.readServer,
  );

  useEffect(() => {
    current.external.revalidate();
  }, [current]);

  useDebugValue(value);

  if (suspense) {
    if (value.status === 'success') {
      return value.data;
    }
    // The server has no cache, so the read after suspending would start a
    // new fetch and suspend again, forever. Fail instead, which makes the
    // nearest Suspense boundary render on the client.
    if (value.status === 'pending' && !IS_CLIENT) {
      throw new Error(SERVER_SUSPENSE_ERROR);
    }
    throw value.data;
  }
  return value;
}

export interface SWRStoreRootProps {
  children?: ReactNode;
}

/**
 * @deprecated `useSWRStore` no longer needs a root, so this component only
 * renders its children.
 */
export function SWRStoreRoot(props: SWRStoreRootProps): ReactNode {
  return props.children;
}
