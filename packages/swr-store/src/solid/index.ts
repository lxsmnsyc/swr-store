import type { Resource } from 'solid-js';
import {
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  sharedConfig,
  untrack,
} from 'solid-js';
import type { MutationResult } from '../cache/mutation-cache';
import { isSameResult, waitForResult } from '../bindings/external-store';
import IS_CLIENT from '../is-client';
import createLazyPromise from '../lazy-promise';
import type { SWRStore } from '../types';

export interface UseSWRStoreOptions<T> {
  initialData?: T;
  shouldRevalidate?: boolean;
  hydrate?: boolean;
}

interface SuspenselessState<T> {
  result: () => MutationResult<T>;
  // Writes data from server rendering to the cache and shows it.
  hydrate: (data: T) => void;
}

// oxlint-disable-next-line typescript/promise-function-async
function toPromise<T>(result: MutationResult<T>): Promise<T> {
  if (result.status === 'success') {
    return Promise.resolve(result.data);
  }
  if (result.status === 'failure') {
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors
    return Promise.reject(result.data);
  }
  return result.data;
}

function createSuspenseless<T, P extends any[]>(
  store: SWRStore<T, P>,
  args: () => P,
  options: UseSWRStoreOptions<T>,
  deferFirstRead: boolean,
): SuspenselessState<T> {
  // Store reads run untracked, so signals read by the store's `get` or `key`
  // do not become dependencies of this hook.
  const read = (currentArgs: P, shouldRevalidate: boolean | undefined): MutationResult<T> =>
    untrack(() =>
      store.get(currentArgs, {
        shouldRevalidate,
        initialData: options.initialData,
        hydrate: options.hydrate,
      }),
    );

  // While hydrating, the resource may already have the server's data, so the
  // first read waits until something needs it instead of fetching right away.
  let firstReadDeferred = deferFirstRead;
  const [result, setResult] = createSignal<MutationResult<T>>(
    deferFirstRead
      ? {
          status: 'pending',
          data: createLazyPromise(async () => {
            firstReadDeferred = false;
            const next = read(untrack(args), options.shouldRevalidate);
            setResult(() => next);
            return toPromise(next);
          }),
        }
      : read(untrack(args), options.shouldRevalidate),
    { equals: isSameResult },
  );

  createEffect((previousKey: string | undefined) => {
    const currentArgs = args();
    const key = untrack(() => store.getKey(currentArgs));
    let active = true;
    if (previousKey !== undefined && previousKey !== key) {
      setResult(() => read(currentArgs, options.shouldRevalidate));
    }
    const unsubscribe = store.subscribe(currentArgs, () => {
      // A listener can still run once after its effect was cleaned up, in the
      // same notification. It must not write data for the old key.
      if (active) {
        setResult(() => read(currentArgs, false));
      }
    });
    onCleanup(() => {
      active = false;
      unsubscribe();
    });
    // The cache may have changed between the first read and the
    // subscription, for example when a fetch settled in between. A deferred
    // first read is left alone, since reading now would start a fetch.
    if (!firstReadDeferred) {
      setResult(() => read(currentArgs, false));
    }
    return key;
  }, undefined);

  return {
    result,
    hydrate: (data) => {
      firstReadDeferred = false;
      const currentArgs = untrack(args);
      untrack(() =>
        store.get(currentArgs, { initialData: data, hydrate: true, shouldRevalidate: false }),
      );
      setResult(() => read(currentArgs, false));
    },
  };
}

export function useSWRStoreSuspenseless<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: () => P,
  options: UseSWRStoreOptions<T> = {},
): () => MutationResult<T> {
  return createSuspenseless(store, args, options, false).result;
}

export function useSWRStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: () => P,
  options: UseSWRStoreOptions<T> = {},
): Resource<T | undefined> {
  const hasInitialData = options.initialData !== undefined;
  const resourceOptions = hasInitialData
    ? {
        initialValue: options.initialData,
        ssrLoadFrom: 'initial' as const,
      }
    : {};

  // Settled data is returned as is, so Solid applies it right away. A pending
  // result gives the resource a promise that also settles when the cache
  // entry is written, so a `mutate` ends the suspense.
  const toResourceValue = (currentArgs: P, result: MutationResult<T>): T | Promise<T> => {
    if (result.status === 'success') {
      return result.data;
    }
    if (result.status === 'failure') {
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors
      return Promise.reject(result.data);
    }
    if (!IS_CLIENT) {
      return result.data;
    }
    return waitForResult(store, currentArgs, result, () =>
      untrack(() =>
        store.get(currentArgs, {
          shouldRevalidate: false,
          initialData: options.initialData,
          hydrate: options.hydrate,
        }),
      ),
    );
  };

  // The server has no cache, so reading the store outside the fetcher would
  // start a new fetch every time the component renders. Solid runs the
  // fetcher once per resource, so the read goes there instead.
  if (!IS_CLIENT) {
    const [serverResource] = createResource(
      args,
      (currentArgs): T | Promise<T> =>
        toResourceValue(
          currentArgs,
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

  const suspenseless = createSuspenseless(
    store,
    args,
    options,
    Boolean(sharedConfig.context) && !hasInitialData,
  );
  const [resource] = createResource(
    suspenseless.result,
    (result): T | Promise<T> => toResourceValue(untrack(args), result),
    {
      ...resourceOptions,
      // Data the server rendered goes into the cache, so the client does
      // not fetch it again.
      onHydrated: (_key, info) => {
        if (info.value !== undefined) {
          suspenseless.hydrate(info.value);
        }
      },
    },
  );
  return resource;
}
