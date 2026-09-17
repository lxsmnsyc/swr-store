import type { Resource } from 'solid-js';
import { createEffect, createResource, createSignal, onCleanup } from 'solid-js';
import type { MutationResult } from '../cache/mutation-cache';
import { isSameArgs, isSameResult } from '../bindings/external-store';
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

  createEffect((previousArgs: P | undefined) => {
    const currentArgs = args();
    if (previousArgs && !isSameArgs(previousArgs, currentArgs)) {
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
    return currentArgs;
  }, undefined);

  return result;
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
      async (currentArgs): Promise<T> => {
        const result = store.get(currentArgs, {
          shouldRevalidate: options.shouldRevalidate,
          initialData: options.initialData,
          hydrate: options.hydrate,
        });
        if (result.status === 'failure') {
          throw result.data;
        }
        return result.data;
      },
      resourceOptions,
    );
    return serverResource;
  }

  const suspenseless = useSWRStoreSuspenseless(store, args, options);
  const [resource] = createResource(
    suspenseless,
    async (result): Promise<T> => {
      if (result.status === 'failure') {
        throw result.data;
      }
      return result.data;
    },
    resourceOptions,
  );
  return resource;
}
