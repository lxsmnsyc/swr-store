import type { Resource } from 'solid-js';
import { createEffect, createResource, createSignal, onCleanup } from 'solid-js';
import type { MutationResult } from '../cache/mutation-cache';
import { isSameArgs, isSameResult } from '../bindings/external-store';
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
  const suspenseless = useSWRStoreSuspenseless(store, args, options);
  const [resource] = createResource(
    suspenseless,
    async (result): Promise<T> => {
      if (result.status === 'failure') {
        throw result.data;
      }
      return result.data;
    },
    'initialData' in options
      ? {
          initialValue: options.initialData,
          ssrLoadFrom: 'initial',
        }
      : {},
  );
  return resource;
}
