import type { ComponentChildren } from 'preact';
import { useSyncExternalStore } from 'preact/compat';
import { useDebugValue, useState } from 'preact/hooks';
import type { MutationResult } from '../cache/mutation-cache';
import type { ExternalStore } from '../bindings/external-store';
import { SERVER_SUSPENSE_ERROR, createExternalStore, isSameArgs } from '../bindings/external-store';
import IS_CLIENT from '../is-client';
import type { SWRStore } from '../types';

interface BaseOptions<T> {
  initialData?: T;
  shouldRevalidate?: boolean;
}

interface WithSuspenseOptions<T> extends BaseOptions<T> {
  suspense: true;
}

interface WithoutSuspenseOptions<T> extends BaseOptions<T> {
  suspense?: false;
}

export type UseSWRStoreOptions<T> = WithSuspenseOptions<T> | WithoutSuspenseOptions<T>;

interface Source<T, P extends any[]> {
  store: SWRStore<T, P>;
  args: P;
  initialData: T | undefined;
  shouldRevalidate: boolean | undefined;
  external: ExternalStore<T>;
}

function createSource<T, P extends any[]>(
  store: SWRStore<T, P>,
  args: P,
  initialData: T | undefined,
  shouldRevalidate: boolean | undefined,
): Source<T, P> {
  return {
    store,
    args,
    initialData,
    shouldRevalidate,
    external: createExternalStore(store, args, {
      initialData,
      shouldRevalidate,
    }),
  };
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
  options: UseSWRStoreOptions<T> = {},
): MutationResult<T> | T {
  const { suspense, initialData, shouldRevalidate } = options;

  const [source, setSource] = useState(() =>
    createSource(store, args, initialData, shouldRevalidate),
  );

  let current = source;
  if (
    current.store !== store ||
    !Object.is(current.initialData, initialData) ||
    current.shouldRevalidate !== shouldRevalidate ||
    !isSameArgs(current.args, args)
  ) {
    current = createSource(store, args, initialData, shouldRevalidate);
    setSource(current);
  }

  const value = useSyncExternalStore(current.external.subscribe, current.external.read);

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
  children?: ComponentChildren;
}

/**
 * @deprecated `useSWRStore` no longer needs a root, so this component only
 * renders its children.
 */
export function SWRStoreRoot(props: SWRStoreRootProps): ComponentChildren {
  return props.children;
}
