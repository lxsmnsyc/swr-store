import type { Resource } from 'solid-js';
import { createEffect, createResource, createSignal, onCleanup } from 'solid-js';
import type { MutationResult } from '../cache/mutation-cache';
import { isSameResult } from '../bindings/external-store';
import IS_CLIENT from '../is-client';
import type { SWRStore } from '../types';

export interface UseSWRStoreOptions<T> {
  initialData?: T;
  shouldRevalidate?: boolean;
  hydrate?: boolean;
}

export function useSWRStoreSuspenseless<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: () => P,
  options: UseSWRStoreOptions<T> = {},
): () => MutationResult<T> {
  const read = (currentArgs: P, shouldRevalidate: boolean | undefined): MutationResult<T> =>
    store.get(currentArgs, {
      shouldRevalidate,
      initialData: options.initialData,
      hydrate: options.hydrate,
    });

  const [result, setResult] = createSignal(read(args(), options.shouldRevalidate), {
    equals: isSameResult,
  });

  createEffect((previousKey: string | undefined) => {
    const currentArgs = args();
    const key = store.getKey(currentArgs);
    if (previousKey !== undefined && previousKey !== key) {
      setResult(() => read(currentArgs, options.shouldRevalidate));
    }
    onCleanup(
      store.subscribe(currentArgs, () => {
        setResult(() => read(currentArgs, false));
      }),
    );
    // The cache may have changed between the first read and the
    // subscription, for example when a fetch settled in between.
    setResult(() => read(currentArgs, false));
    return key;
  }, undefined);

  return result;
}

// Returns settled data as is, so Solid applies it right away. Only a pending
// result gives the resource a promise, which is when it should show as
// loading.
// oxlint-disable-next-line typescript/promise-function-async
function toResourceValue<T>(result: MutationResult<T>): T | Promise<T> {
  if (result.status === 'failure') {
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors
    return Promise.reject(result.data);
  }
  return result.data;
}

export function useSWRStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: () => P,
  options: UseSWRStoreOptions<T> = {},
): Resource<T | undefined> {
  const resourceOptions =
    'initialData' in options
      ? {
          initialValue: options.initialData,
          ssrLoadFrom: 'initial' as const,
        }
      : {};

  // The server has no cache, so reading the store outside the fetcher would
  // start a new fetch every time the component renders. Solid runs the
  // fetcher once per resource, so the read goes there instead.
  if (!IS_CLIENT) {
    const [serverResource] = createResource(
      args,
      (currentArgs): T | Promise<T> =>
        toResourceValue(
          store.get(currentArgs, {
            shouldRevalidate: options.shouldRevalidate,
            initialData: options.initialData,
            hydrate: options.hydrate,
          }),
        ),
      resourceOptions,
    );
    return serverResource;
  }

  const suspenseless = useSWRStoreSuspenseless(store, args, options);
  const [resource] = createResource(suspenseless, toResourceValue, resourceOptions);
  return resource;
}
