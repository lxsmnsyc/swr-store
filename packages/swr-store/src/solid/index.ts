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
import { isSameArgs, isSameResult, waitForResult } from '../bindings/external-store';
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
  // Starts a deferred first read, when hydration brought no data.
  startRead: () => void;
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

  // The active subscription. Arguments can change without changing the
  // key, for example a token the key leaves out. Then the new subscription
  // starts before the old one ends, so the store keeps its polling and event
  // listeners running.
  interface Subscription {
    key: string;
    args: P;
    unsubscribe: () => void;
  }
  let subscription: Subscription | undefined;

  createEffect(() => {
    const currentArgs = args();
    const key = untrack(() => store.getKey(currentArgs));
    const previous = subscription;
    if (previous?.key === key && isSameArgs(previous.args, currentArgs)) {
      return;
    }

    const entry: Subscription = { key, args: currentArgs, unsubscribe: () => undefined };
    entry.unsubscribe = untrack(() =>
      store.subscribe(currentArgs, () => {
        // A listener can still run once after it was replaced, in the same
        // notification. It must not write data for an old key.
        if (subscription === entry) {
          setResult(() => read(entry.args, false));
        }
      }),
    );
    subscription = entry;
    previous?.unsubscribe();

    if (previous) {
      if (previous.key !== key) {
        setResult(() => read(currentArgs, options.shouldRevalidate));
      }
    } else if (!firstReadDeferred) {
      // The cache may have changed between the first read and the
      // subscription, for example when a fetch settled in between. A
      // deferred first read is left alone, since reading now would start a
      // fetch.
      setResult(() => read(currentArgs, false));
    }
  });

  onCleanup(() => {
    subscription?.unsubscribe();
    subscription = undefined;
  });

  return {
    result,
    hydrate: (data) => {
      firstReadDeferred = false;
      const currentArgs = untrack(args);
      untrack(() => {
        const existing = store.get(currentArgs, {
          initialData: data,
          hydrate: true,
          shouldRevalidate: false,
        });
        // Another reader of the key, such as `useSWRStoreSuspenseless`, may
        // have started a fetch first. The server's data replaces that pending
        // entry, so it is not fetched again.
        if (existing.status === 'pending') {
          store.mutate(currentArgs, { data, status: 'success' }, false);
        }
      });
      setResult(() => read(currentArgs, false));
    },
    startRead: () => {
      if (!firstReadDeferred) {
        return;
      }
      firstReadDeferred = false;
      setResult(() => read(untrack(args), options.shouldRevalidate));
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
      // Initial data given without `hydrate` stays a placeholder, as it does
      // outside hydration. Without data, such as when the server failed, the
      // client fetches.
      onHydrated: (_key, info) => {
        if (info.value === undefined) {
          suspenseless.startRead();
        } else if (!hasInitialData || options.hydrate) {
          suspenseless.hydrate(info.value);
        }
      },
    },
  );
  return resource;
}
