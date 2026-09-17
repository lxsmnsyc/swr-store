import type { MutationPending, MutationResult } from './cache/mutation-cache';
import { getMutation, setMutation } from './cache/mutation-cache';
import { setRevalidation, subscribeRevalidation } from './cache/revalidation-cache';
import getDefaultConfig from './default-config';
import { mutate, subscribe, trigger } from './global';
import IS_CLIENT, { HAS_DOCUMENT, HAS_WINDOW_EVENTS } from './is-client';
import type { Retry } from './retry';
import retry from './retry';
import type { SWRFullOptions, SWRGetOptions, SWRStore, SWRStoreOptions } from './types';

let index = 0;

function getIndex(): number {
  const current = index;
  index += 1;
  return current;
}

const retries = new Map<string, Retry<any>>();

// Copies the options that are set, so an `undefined` value keeps the default.
function withDefaults<T extends object>(defaults: T, options?: Partial<T>): T {
  const result = { ...defaults };
  if (options) {
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined) {
        Reflect.set(result, key, value);
      }
    }
  }
  return result;
}

// Reads the cache for `args` and fetches when the cache is missing, stale or
// expired. With `force`, it fetches even when the cache is fresh.
function revalidate<T, P extends any[] = []>(
  fullOpts: SWRFullOptions<T, P>,
  args: P,
  opts?: SWRGetOptions<T>,
  force = false,
): MutationResult<T> {
  const { shouldRevalidate, initialData, hydrate } = withDefaults<SWRGetOptions<T>>(
    {
      shouldRevalidate: true,
      initialData: fullOpts.initialData,
      hydrate: false,
    },
    opts,
  );
  // The server has no cache, so every read is on its own. Initial data is
  // returned as is. Anything else gets a pending result whose fetch only
  // starts once something waits on it, so a render that only checks the
  // status does not send a request.
  if (!IS_CLIENT) {
    if (initialData !== undefined) {
      return { data: initialData, status: 'success' };
    }
    return {
      data: createLazyPromise(
        async () =>
          // Unlimited retries would keep a timer running after the request
          // ends, so the server only retries when `maxRetryCount` is set.
          retry(async () => fullOpts.get(...args), {
            count: fullOpts.maxRetryCount ?? 0,
            interval: fullOpts.maxRetryInterval,
          }).resolvable.promise,
      ),
      status: 'pending',
    };
  }

  // Parse key
  const generatedKey = fullOpts.key(...args);

  // Capture timestamp
  const timestamp = Date.now();

  // Get current mutation
  let currentMutation = getMutation<T>(generatedKey);

  // Initial data that is not written to the cache is only a placeholder.
  // It is never fresh, so it does not stop the first fetch.
  let isPlaceholder = false;

  // Hydrate mutation
  if (!currentMutation && initialData !== undefined) {
    currentMutation = {
      result: {
        data: initialData,
        status: 'success',
      },
      timestamp,
      isValidating: false,
    };

    if (hydrate) {
      setMutation(generatedKey, currentMutation);
    } else {
      isPlaceholder = true;
    }
  }

  let previousRetry: Retry<T> | undefined;

  if (currentMutation) {
    if (!shouldRevalidate) {
      return currentMutation.result;
    }
    if (isPlaceholder) {
      // A fetch for this key is already running and will fill the cache.
      if (retries.has(generatedKey)) {
        return currentMutation.result;
      }
    } else if (!force && currentMutation.timestamp + fullOpts.freshAge > timestamp) {
      // If mutation is still fresh, return mutation
      return currentMutation.result;
    }

    // A pending fetch that is no longer fresh gets replaced by a new one.
    // It is cancelled below, so it stops retrying.
    if (currentMutation.result.status === 'pending') {
      previousRetry = retries.get(generatedKey);
    }
  }

  // Perform fetch
  const pendingRetry = retry(async () => fullOpts.get(...args), {
    count: fullOpts.maxRetryCount,
    interval: fullOpts.maxRetryInterval,
  });

  // Set current retry
  retries.set(generatedKey, pendingRetry);

  const pendingData = pendingRetry.resolvable.promise;

  // The old promise settles with the new fetch, so whoever still waits on it
  // gets the new data.
  previousRetry?.cancel(pendingData);

  // Capture result
  const result: MutationPending<T> = {
    data: pendingData,
    status: 'pending',
  };

  const clearRetry = (): void => {
    if (retries.get(generatedKey) === pendingRetry) {
      retries.delete(generatedKey);
    }
  };

  // Watch for promise resolutions
  // to update cache data
  pendingData.then(
    (data) => {
      clearRetry();
      const mutation = getMutation<T>(generatedKey);

      // A newer write or fetch happened while this one ran. Keep it.
      if (mutation && mutation.timestamp > timestamp) {
        return;
      }

      // The data did not change, so subscribers only learn that the
      // revalidation is over.
      if (mutation?.result.status === 'success' && fullOpts.compare(mutation.result.data, data)) {
        if (mutation.isValidating) {
          setMutation(generatedKey, { ...mutation, isValidating: false });
        }
        return;
      }

      setMutation(generatedKey, {
        result: {
          data,
          status: 'success',
        },
        // A zero timestamp counts as missing.
        // oxlint-disable-next-line typescript/prefer-nullish-coalescing
        timestamp: mutation?.timestamp || Date.now(),
        isValidating: false,
      });
    },
    (data: unknown) => {
      clearRetry();
      const mutation = getMutation<T>(generatedKey);

      // A newer write or fetch happened while this one ran. Keep it.
      if (mutation && mutation.timestamp > timestamp) {
        return;
      }

      setMutation(generatedKey, {
        result: {
          data,
          status: 'failure',
        },
        // A zero timestamp counts as missing.
        // oxlint-disable-next-line typescript/prefer-nullish-coalescing
        timestamp: mutation?.timestamp || Date.now(),
        isValidating: false,
      });
    },
  );

  // A placeholder keeps being returned until the fetch fills the cache.
  if (currentMutation && isPlaceholder) {
    return currentMutation.result;
  }

  // If there's an existing mutation
  // and mutation is stale
  // keep its result while the fetch runs
  if (
    currentMutation &&
    currentMutation.timestamp + fullOpts.freshAge + fullOpts.staleAge > timestamp
  ) {
    // Updating this means that the freshness or the staleness
    // of a mutation resets
    setMutation(generatedKey, {
      result: currentMutation.result,
      timestamp,
      isValidating: true,
    });
    return currentMutation.result;
  }

  // Otherwise, set the new mutation
  setMutation(generatedKey, {
    result,
    timestamp,
    isValidating: true,
  });

  return result;
}

// A promise that calls `start` the first time it is awaited or chained.
// It cannot be an `async` function, because awaiting the returned object
// would call `then` and start the work right away.
// oxlint-disable-next-line typescript/promise-function-async
function createLazyPromise<T>(start: () => Promise<T>): Promise<T> {
  let promise: Promise<T> | undefined;
  const get = async (): Promise<T> => {
    promise ??= start();
    return promise;
  };
  return {
    [Symbol.toStringTag]: 'Promise',
    // oxlint-disable-next-line unicorn/no-thenable
    then: async (onFulfilled, onRejected) => get().then(onFulfilled, onRejected),
    catch: async (onRejected) => get().catch(onRejected),
    finally: async (onFinally) => get().finally(onFinally),
  };
}

type Cleanup = () => void;

// Starts the revalidation sources of a store for one key: the revalidation
// listener, the event listeners and polling. Returns the cleanups.
function register<T, P extends any[] = []>(
  generatedKey: string,
  fullOpts: SWRFullOptions<T, P>,
  getArgs: () => P,
): Cleanup[] {
  const cleanups: Cleanup[] = [];

  cleanups.push(
    subscribeRevalidation(generatedKey, (force) => {
      revalidate(fullOpts, getArgs(), undefined, force);
    }),
  );

  // Only register on client-side
  if (!IS_CLIENT) {
    return cleanups;
  }

  const onRevalidate = (): void => {
    setRevalidation(generatedKey, false);
  };

  // Polls while `isActive` returns true. The check runs on every event in
  // `events` and once at the start, so polling begins right away when the
  // page is already in that state.
  const pollWhile = (target: EventTarget, events: string[], isActive: () => boolean): void => {
    let interval: ReturnType<typeof setInterval> | undefined;

    const update = (): void => {
      clearInterval(interval);
      interval = isActive() ? setInterval(onRevalidate, fullOpts.refreshInterval) : undefined;
    };

    for (const event of events) {
      target.addEventListener(event, update, false);
    }
    update();

    cleanups.push(() => {
      for (const event of events) {
        target.removeEventListener(event, update, false);
      }
      clearInterval(interval);
    });
  };

  // Register polling interval
  if (fullOpts.refreshInterval != null) {
    // Each state needs its own events. Where they are missing, such as in
    // React Native or a web worker, that kind of polling does not start.
    if (fullOpts.refreshWhenBlurred && HAS_WINDOW_EVENTS && HAS_DOCUMENT) {
      pollWhile(window, ['blur', 'focus'], () => !document.hasFocus());
    }
    if (fullOpts.refreshWhenOffline && HAS_WINDOW_EVENTS) {
      pollWhile(window, ['offline', 'online'], () => !navigator.onLine);
    }
    if (fullOpts.refreshWhenHidden && HAS_DOCUMENT) {
      pollWhile(document, ['visibilitychange'], () => document.visibilityState !== 'visible');
    }
    if (
      !(fullOpts.refreshWhenHidden || fullOpts.refreshWhenBlurred || fullOpts.refreshWhenOffline)
    ) {
      const interval = setInterval(onRevalidate, fullOpts.refreshInterval);
      cleanups.push(() => {
        clearInterval(interval);
      });
    }
  }

  const listen = (target: EventTarget, event: string, listener: () => void): void => {
    target.addEventListener(event, listener, false);
    cleanups.push(() => {
      target.removeEventListener(event, listener, false);
    });
  };

  // Registers a focus event for revalidation.
  if (fullOpts.revalidateOnFocus && HAS_WINDOW_EVENTS) {
    listen(window, 'focus', onRevalidate);
  }

  // Registers a online event for revalidation.
  if (fullOpts.revalidateOnNetwork && HAS_WINDOW_EVENTS) {
    listen(window, 'online', onRevalidate);
  }

  // Registers a visibility change event for revalidation.
  if (fullOpts.revalidateOnVisibility && HAS_DOCUMENT) {
    listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        onRevalidate();
      }
    });
  }

  return cleanups;
}

interface Registration<P> {
  // The arguments of each active subscriber, oldest first.
  subscribers: Set<{ args: P }>;
  cleanups: Cleanup[];
}

export default function createSWRStore<T, P extends any[] = []>(
  options: SWRStoreOptions<T, P>,
): SWRStore<T, P> {
  const id = `SWRStore-${getIndex()}`;
  const defaults = getDefaultConfig<T, P>();
  // The default key starts with the store name, or the store id when there is
  // no name, so two stores called with the same arguments do not share a
  // cache entry.
  const prefix = options.name ?? id;
  defaults.key = (...args: P): string => `${prefix}:${JSON.stringify(args)}`;

  const fullOpts: SWRFullOptions<T, P> = {
    ...options,
    ...withDefaults(defaults, options),
  };

  // Every store counts its own subscribers per key, and starts and stops its
  // own revalidation sources. Other stores or global subscribers on the same
  // key do not affect it.
  const registrations = new Map<string, Registration<P>>();

  return {
    id,
    getKey: (args) => fullOpts.key(...args),
    trigger: (args, shouldRevalidate = true) => {
      trigger(fullOpts.key(...args), shouldRevalidate);
    },
    mutate: (args, data, shouldRevalidate = true, compare = fullOpts.compare) => {
      mutate(fullOpts.key(...args), data, shouldRevalidate, compare);
    },
    // This function revalidates the mutation cache
    // through reactive process
    get: (args, opts) => revalidate(fullOpts, args, opts),
    subscribe: (args, listener) => {
      const generatedKey = fullOpts.key(...args);

      let registration = registrations.get(generatedKey);
      if (!registration) {
        const subscribers = new Set<{ args: P }>();
        registration = {
          subscribers,
          // A custom key may leave out some arguments, such as a token.
          // Revalidation uses the newest active subscriber's arguments, so
          // it does not keep using those of a subscriber that left.
          cleanups: register(generatedKey, fullOpts, () => {
            let latest = args;
            for (const subscriber of subscribers) {
              latest = subscriber.args;
            }
            return latest;
          }),
        };
        registrations.set(generatedKey, registration);
      }
      const current = registration;
      const entry = { args };
      current.subscribers.add(entry);

      const unsubscribe = subscribe(generatedKey, listener);
      return () => {
        if (!current.subscribers.delete(entry)) {
          return;
        }
        unsubscribe();
        if (current.subscribers.size === 0) {
          for (const cleanup of current.cleanups) {
            cleanup();
          }
          registrations.delete(generatedKey);
        }
      };
    },
  };
}
