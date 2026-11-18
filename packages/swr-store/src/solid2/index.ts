import type { Accessor } from 'solid-js';
import {
  createEffect,
  createMemo,
  createSignal,
  isHydrating,
  onCleanup,
  onHydrationEnd,
  untrack,
} from 'solid-js';
import type { SWRResult } from '../cache/mutation-cache';
import { hydrateOnce, isSameArgs, isSameResult, waitForResult } from '../bindings/external-store';
import IS_CLIENT from '../is-client';
import type { SWRStore } from '../types';

export interface UseSWRStoreOptions<T> {
  initialData?: T;
  revalidate?: boolean;
  hydrate?: boolean;
}

// How a hook starts.
// - `read`: reads the store and subscribes right away.
// - `hydrate`: shows a pending result, and waits for `begin` or `hydrate`
//   to read and subscribe.
// - `skip`: never reads, for a server render that reads elsewhere.
type StartMode = 'read' | 'hydrate' | 'skip';

interface ResultState<T, P> {
  result: Accessor<SWRResult<T>>;
  // Initial data for a read with `args`. It only applies to the first key.
  getInitialData: (args: P) => T | undefined;
  // True while a hydrating hook has not read the store yet.
  isWaiting: () => boolean;
  // Reads the store and subscribes, once.
  begin: () => void;
  // Writes data from server rendering to the cache, then begins.
  hydrate: (data: T) => void;
}

// oxlint-disable-next-line typescript/promise-function-async
function createNeverSettling<T>(): Promise<T> {
  return new Promise<T>(() => {
    // Never settles.
  });
}

const NEVER_SETTLES: Promise<never> = createNeverSettling();

function createResultState<T, P extends any[]>(
  store: SWRStore<T, P>,
  args: () => P,
  options: UseSWRStoreOptions<T>,
  mode: StartMode,
): ResultState<T, P> {
  // Initial data belongs to the first key. Another key would otherwise show
  // or cache data that is not its own.
  const firstKey = untrack(() => store.getKey(args()));
  function isFirstKey(currentArgs: P): boolean {
    return untrack(() => store.getKey(currentArgs)) === firstKey;
  }
  function getInitialData(currentArgs: P): T | undefined {
    return isFirstKey(currentArgs) ? options.initialData : undefined;
  }

  // Store reads run untracked, so signals read by the store's `get` or `key`
  // do not become dependencies of this hook.
  function read(currentArgs: P, revalidate: boolean | undefined): SWRResult<T> {
    return untrack(() =>
      store.get(currentArgs, { revalidate, initialData: getInitialData(currentArgs) }),
    );
  }

  // The first read for a key writes hydrated initial data first.
  function readFirst(currentArgs: P): SWRResult<T> {
    if (options.hydrate && isFirstKey(currentArgs)) {
      untrack(() => {
        hydrateOnce(store, currentArgs, options.initialData);
      });
    }
    return read(currentArgs, options.revalidate);
  }

  let waiting = mode === 'hydrate';
  let disposed = false;

  // While hydrating, the server's data may already be on the way, so the
  // hook waits with a pending result until `begin` or `hydrate`.
  const first: SWRResult<T> =
    mode === 'read' ? readFirst(untrack(args)) : { status: 'pending', data: NEVER_SETTLES };

  // The store notifies from anywhere, including a component body or a
  // computation that calls `mutate`, so the signal accepts writes from an
  // owned scope. Only this hook writes it.
  const [result, setResult] = createSignal<SWRResult<T>>(first, {
    equals: isSameResult,
    ownedWrite: true,
  });

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

  function subscribeTo(currentArgs: P): void {
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

    if (previous && previous.key !== key) {
      setResult(() => readFirst(currentArgs));
    }
  }

  // The first subscription starts with the first read. Solid holds effects
  // under a pending `<Loading>` or a failed `<Errored>`, and the reader must
  // still see a `mutate` there. The server keeps no subscriptions.
  if (mode === 'read' && IS_CLIENT) {
    subscribeTo(untrack(args));
  }

  // Reads and subscribes, once.
  function begin(): void {
    if (!waiting || disposed) {
      return;
    }
    waiting = false;
    const currentArgs = untrack(args);
    subscribeTo(currentArgs);
    setResult(() => readFirst(currentArgs));
  }

  // Later arguments move the subscription.
  createEffect(args, (currentArgs) => {
    if (subscription) {
      subscribeTo(currentArgs);
    }
  });

  onCleanup(() => {
    disposed = true;
    subscription?.unsubscribe();
    subscription = undefined;
  });

  return {
    result,
    getInitialData,
    isWaiting: () => waiting,
    begin,
    hydrate: (data) => {
      if (!waiting || disposed) {
        return;
      }
      untrack(() => {
        store.hydrate(untrack(args), data);
      });
      begin();
    },
  };
}

/**
 * Reads a store as a signal of its result: pending, success or failure. It
 * never suspends and never throws.
 */
export function useSWRStoreSuspenseless<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: () => P,
  options: UseSWRStoreOptions<T> = {},
): Accessor<SWRResult<T>> {
  return createResultState(store, args, options, 'read').result;
}

/**
 * Reads a store as an async accessor. A read without data waits under the
 * nearest `<Loading>`, a failure goes to the nearest `<Errored>`, and data
 * stays on screen while it revalidates.
 */
export function useSWRStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: () => P,
  options: UseSWRStoreOptions<T> = {},
): Accessor<T> {
  // The server has no cache, so every store read starts a fetch. The server
  // reads once, inside the memo, and the state below only keeps the client
  // and the server creating the same computations, which hydration matches
  // by position.
  let mode: StartMode = 'read';
  if (!IS_CLIENT) {
    mode = 'skip';
  } else if (isHydrating() && options.initialData === undefined) {
    mode = 'hydrate';
  }
  const state = createResultState(store, args, options, mode);

  // While hydrating, Solid runs this compute once with a fake `fetch` and
  // `Promise`, and waits on what it returns. A read started then would cache
  // a fetch that never settles, so a waiting hook returns a promise that
  // starts nothing. The hydration end handler below begins the read.
  const waitingForHydration = createNeverSettling<T>();
  const data = createMemo((): T | Promise<T> => {
    const result =
      mode === 'skip'
        ? untrack(() =>
            store.get(untrack(args), {
              revalidate: options.revalidate,
              initialData: options.initialData,
            }),
          )
        : state.result();
    if (result.status === 'success') {
      return result.data;
    }
    if (result.status === 'failure') {
      throw result.data;
    }
    if (mode === 'skip') {
      return result.data;
    }
    if (state.isWaiting()) {
      return waitingForHydration;
    }
    // A promise that also settles when the cache entry is written, so a
    // `mutate` ends the wait however the read started.
    const currentArgs = untrack(args);
    return waitForResult(store, currentArgs, result, () =>
      untrack(() =>
        store.get(currentArgs, {
          revalidate: false,
          initialData: state.getInitialData(currentArgs),
        }),
      ),
    );
  });

  // After hydration, data the server rendered goes into the cache, so the
  // client does not fetch it again. Without data, such as when the server
  // failed, the client fetches.
  if (mode === 'hydrate') {
    onHydrationEnd(() => {
      if (!state.isWaiting()) {
        return;
      }
      let value: T;
      try {
        value = untrack(data);
      } catch {
        state.begin();
        return;
      }
      state.hydrate(value);
    });
  }

  return data;
}
