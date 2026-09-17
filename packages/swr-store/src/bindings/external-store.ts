import type { SWRPending, SWRResult } from '../cache/mutation-cache';
import { subscribe } from '../global';
import IS_CLIENT from '../is-client';
import { getServerRead } from '../server-read';
import type { SWRStore } from '../types';

export const SERVER_SUSPENSE_ERROR =
  'useSWRStore cannot suspend on the server because the server has no cache. Pass initialData, or let the Suspense boundary render on the client.';

export interface ExternalStoreOptions<T> {
  initialData?: T;
  revalidate?: boolean;
  hydrate?: boolean;
}

export interface ExternalStore<T> {
  read: () => SWRResult<T>;
  // What the server rendered. Used during hydration.
  readServer: () => SWRResult<T>;
  subscribe: (notify: () => void) => () => void;
  // Revalidates a failure during render, so a component that throws it can
  // recover once the failure is no longer fresh.
  retryFailure: () => SWRResult<T>;
  // A promise that resolves when a pending result can be shown. It never
  // rejects, and its value is not the data. React can replay a suspended
  // render with the promise of an earlier attempt, so the data is always
  // read from the store instead.
  wait: (pending: SWRPending<T>) => Promise<void>;
  // Uses newer arguments for the same cache key, such as a new token. Call it
  // after each render commits.
  setArgs: (args: unknown[]) => void;
  // Revalidates the entry once. Call it after the component mounts.
  revalidate: () => void;
}

// Keys that a hook already hydrated on this page.
const HYDRATED = new Set<string>();

// Hydrates a key once per page. Server data is only current when the page
// loads, so a hook that mounts later must not write it again, for example
// after the entry expired or was removed from the cache.
export function hydrateOnce<T, P extends any[]>(
  store: SWRStore<T, P>,
  args: P,
  initialData: T | undefined,
): void {
  if (!IS_CLIENT) {
    return;
  }
  const key = store.getKey(args);
  if (HYDRATED.has(key)) {
    return;
  }
  HYDRATED.add(key);
  store.hydrate(args, initialData);
}

const WAITERS = new WeakMap<SWRPending<unknown>, Promise<unknown>>();

// Returns a promise for a suspended component to wait on. It settles when the
// pending result's fetch settles or when the cache entry is written, whichever
// comes first. A component suspended on its first mount is not subscribed, so
// without this, a `mutate` would not end the suspense.
//
// The promise resolves with the data once the entry holds a success, and
// rejects with the error of a failure. It is shared by every render that
// waits on the same pending result.
// oxlint-disable-next-line typescript/promise-function-async
export function waitForResult<T, P extends any[]>(
  store: SWRStore<T, P>,
  args: P,
  pending: SWRPending<T>,
  read: () => SWRResult<T>,
): Promise<T> {
  const existing = WAITERS.get(pending);
  if (existing) {
    // Waiters are stored by their own pending result, so the types match.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return existing as Promise<T>;
  }
  const waiter = new Promise<T>((resolve, reject) => {
    let done = false;
    const subscription = { unsubscribe: (): void => undefined };
    const check = (): void => {
      if (done) {
        return;
      }
      const next = read();
      // A write that keeps the same pending result, such as the fetch's own
      // bookkeeping, changes nothing. Keep waiting.
      if (next === pending) {
        return;
      }
      done = true;
      subscription.unsubscribe();
      if (next.status === 'success') {
        resolve(next.data);
      } else if (next.status === 'failure') {
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors
        reject(next.data);
      } else {
        waitForResult(store, args, next, read).then(resolve, reject);
      }
    };
    subscription.unsubscribe = subscribe(store.getKey(args), check);
    // When the fetch settles, its result is read from the cache. A fetch
    // whose result was dropped for a newer write still ends the wait here,
    // and the read shows that write instead.
    pending.data.then(check, check);
  });
  // The waiter may be dropped without anyone handling its rejection.
  waiter.catch(() => undefined);
  WAITERS.set(pending, waiter);
  return waiter;
}

// A promise that React's `use` reads right away, without suspending. React
// checks `status` and `value` on the promise, which is how it marks promises
// it has already seen settle.
export const SETTLED: Promise<void> = Object.assign(Promise.resolve(), {
  status: 'fulfilled',
  value: undefined,
});

const SUSPENDERS = new WeakMap<SWRPending<unknown>, Promise<void>>();

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

export function isSameResult<T>(a: SWRResult<T>, b: SWRResult<T>): boolean {
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
  // The key stays the same, but arguments the key leaves out, such as a
  // token, can change. Reads and the subscription use the latest ones.
  let latestArgs = args;
  let resubscribe: (() => void) | undefined;

  const read = (revalidate: boolean): SWRResult<T> =>
    store.get(latestArgs, { revalidate, initialData: options.initialData });

  if (options.hydrate) {
    hydrateOnce(store, args, options.initialData);
  }
  let current = read(false);

  const refresh = (): boolean => {
    const next = read(false);
    if (isSameResult(current, next)) {
      return false;
    }
    current = next;
    return true;
  };

  let serverResult: SWRResult<T> | undefined;
  let revalidated = false;

  return {
    read: (): SWRResult<T> => {
      // A component that suspends again after mounting can miss the
      // notification for the fetch it waits on. Reading the cache again
      // while pending lets its retry see the settled result.
      if (current.status === 'pending') {
        refresh();
      }
      return current;
    },
    readServer: (): SWRResult<T> => {
      // The snapshot has to stay the same object between calls.
      serverResult ??=
        getServerRead(store)?.(latestArgs, { initialData: options.initialData }) ?? current;
      return serverResult;
    },
    subscribe: (notify): (() => void) => {
      const listener = (): void => {
        if (refresh()) {
          notify();
        }
      };
      let unsubscribe = store.subscribe(latestArgs, listener);
      // Subscribing with new arguments before leaving the old subscription
      // keeps the store's polling and event listeners running.
      resubscribe = (): void => {
        const next = store.subscribe(latestArgs, listener);
        unsubscribe();
        unsubscribe = next;
      };
      // The cache may have changed between the first read and the
      // subscription, for example when a fetch settled in between.
      listener();
      return () => {
        resubscribe = undefined;
        unsubscribe();
      };
    },
    setArgs: (next): void => {
      // The hook passes the arguments of the render, which match `P`.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const nextArgs = next as P;
      if (isSameArgs(latestArgs, nextArgs)) {
        return;
      }
      latestArgs = nextArgs;
      resubscribe?.();
    },
    retryFailure: (): SWRResult<T> => {
      const next = read(true);
      if (!isSameResult(current, next)) {
        current = next;
      }
      return current;
    },
    // oxlint-disable-next-line typescript/promise-function-async
    wait: (pending): Promise<void> => {
      let suspender = SUSPENDERS.get(pending);
      if (!suspender) {
        suspender = waitForResult(store, latestArgs, pending, () => read(false)).then(
          () => undefined,
          () => undefined,
        );
        SUSPENDERS.set(pending, suspender);
      }
      return suspender;
    },
    revalidate: (): void => {
      // Only once. React runs effects again when suspended content comes
      // back, and in StrictMode on every mount. Revalidating each time would
      // replace data that just arrived and suspend again.
      if (revalidated || options.revalidate === false) {
        return;
      }
      revalidated = true;
      read(true);
    },
  };
}
