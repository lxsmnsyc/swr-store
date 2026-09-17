import type { MutationResult } from '../cache/mutation-cache';
import { getServerRead } from '../server-read';
import type { SWRStore } from '../types';

export const SERVER_SUSPENSE_ERROR =
  'useSWRStore cannot suspend on the server because the server has no cache. Pass initialData, or let the Suspense boundary render on the client.';

export interface ExternalStoreOptions<T> {
  initialData?: T;
  shouldRevalidate?: boolean;
}

export interface ExternalStore<T> {
  read: () => MutationResult<T>;
  // What the server rendered. Used during hydration.
  readServer: () => MutationResult<T>;
  subscribe: (notify: () => void) => () => void;
}

export function isSameResult<T>(a: MutationResult<T>, b: MutationResult<T>): boolean {
  return a.status === b.status && Object.is(a.data, b.data);
}

export function isSameArgs<P extends unknown[]>(prev: P, next: P): boolean {
  if (prev === next) {
    return true;
  }
  if (prev.length !== next.length) {
    return false;
  }
  for (let i = 0; i < prev.length; i += 1) {
    if (!Object.is(prev[i], next[i])) {
      return false;
    }
  }
  return true;
}

// Wraps a store read in the shape `useSyncExternalStore` expects. Reading a
// store can start a fetch, so the result is read once and then cached, and
// only replaced when the store notifies. Returning a fresh object from every
// snapshot read would make the renderer loop forever.
export function createExternalStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: P,
  options: ExternalStoreOptions<T>,
): ExternalStore<T> {
  let current = store.get(args, {
    shouldRevalidate: options.shouldRevalidate,
    initialData: options.initialData,
  });

  const refresh = (): boolean => {
    const next = store.get(args, {
      shouldRevalidate: false,
      initialData: options.initialData,
    });
    if (isSameResult(current, next)) {
      return false;
    }
    current = next;
    return true;
  };

  let serverResult: MutationResult<T> | undefined;

  return {
    read: (): MutationResult<T> => current,
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
  };
}
