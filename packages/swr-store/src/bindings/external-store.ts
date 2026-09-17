import type { MutationResult } from '../cache/mutation-cache';
import { getServerRead } from '../server-read';
import type { SWRStore } from '../types';

export const SERVER_SUSPENSE_ERROR =
  'useSWRStore cannot suspend on the server because the server has no cache. Pass initialData, or let the Suspense boundary render on the client.';

export interface ExternalStoreOptions<T> {
  initialData?: T;
  shouldRevalidate?: boolean;
  hydrate?: boolean;
}

export interface ExternalStore<T> {
  read: () => MutationResult<T>;
  // What the server rendered. Used during hydration.
  readServer: () => MutationResult<T>;
  subscribe: (notify: () => void) => () => void;
  // Revalidates the entry once. Call it after the component mounts.
  revalidate: () => void;
}

export function isSameResult<T>(a: MutationResult<T>, b: MutationResult<T>): boolean {
  return a.status === b.status && Object.is(a.data, b.data);
}

// Wraps a store in the shape `useSyncExternalStore` expects.
//
// Rendering only reads the cache. It starts a fetch only when there is
// nothing to show, since a component that suspends needs a promise to wait
// on. Revalidation happens after the component mounts. This way a render
// retried after suspending gets the data it waited for, even when that data
// has already expired, and rendering never writes to the cache.
//
// The result is read once and then kept until the store notifies, because
// returning a new object from every snapshot read would make the renderer
// loop forever.
export function createExternalStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: P,
  options: ExternalStoreOptions<T>,
): ExternalStore<T> {
  const read = (shouldRevalidate: boolean): MutationResult<T> =>
    store.get(args, {
      shouldRevalidate,
      initialData: options.initialData,
      hydrate: options.hydrate,
    });

  let current = read(false);

  const refresh = (): boolean => {
    const next = read(false);
    if (isSameResult(current, next)) {
      return false;
    }
    current = next;
    return true;
  };

  let serverResult: MutationResult<T> | undefined;
  let revalidated = false;

  return {
    read: (): MutationResult<T> => {
      // A component that suspends again after mounting can miss the
      // notification for the fetch it waits on. Reading the cache again
      // while pending lets its retry see the settled result.
      if (current.status === 'pending') {
        refresh();
      }
      return current;
    },
    readServer: (): MutationResult<T> => {
      // The snapshot has to stay the same object between calls.
      serverResult ??=
        getServerRead(store)?.(args, { initialData: options.initialData }) ?? current;
      return serverResult;
    },
    subscribe: (notify): (() => void) => {
      const unsubscribe = store.subscribe(args, () => {
        if (refresh()) {
          notify();
        }
      });
      // The cache may have changed between the first read and the
      // subscription, for example when a fetch settled in between.
      if (refresh()) {
        notify();
      }
      return unsubscribe;
    },
    revalidate: (): void => {
      // Only once. React runs effects again when suspended content comes
      // back, and in StrictMode on every mount. Revalidating each time would
      // replace data that just arrived and suspend again.
      if (revalidated || options.shouldRevalidate === false) {
        return;
      }
      revalidated = true;
      read(true);
    },
  };
}
