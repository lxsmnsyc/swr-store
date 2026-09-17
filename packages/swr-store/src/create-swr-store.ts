import type { MutationPending, MutationResult } from './cache/mutation-cache';
import { getMutation, setMutation } from './cache/mutation-cache';
import { setRevalidation, subscribeRevalidation } from './cache/revalidation-cache';
import getDefaultConfig from './default-config';
import { mutate, subscribe, trigger } from './global';
import IS_CLIENT from './is-client';
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
  // returned as is, and anything else starts a fetch that no other read
  // shares.
  if (!IS_CLIENT) {
    if (initialData !== undefined) {
      return { data: initialData, status: 'success' };
    }
    // Unlimited retries would keep a timer running after the request ends, so
    // the server only retries when `maxRetryCount` is set.
    const data = retry(async () => fullOpts.get(...args), {
      count: fullOpts.maxRetryCount ?? 0,
      interval: fullOpts.maxRetryInterval,
    }).resolvable.promise;
    // The caller may never read the promise. Mark the rejection as handled so
    // a failed fetch does not crash the process.
    data.catch(() => undefined);
    return { data, status: 'pending' };
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

type Cleanup = () => void;

// Starts the revalidation sources of a store for one key: the revalidation
// listener, the event listeners and polling. Returns the cleanups.
function register<T, P extends any[] = []>(
  generatedKey: string,
  fullOpts: SWRFullOptions<T, P>,
  args: P,
): Cleanup[] {
  const cleanups: Cleanup[] = [];

  cleanups.push(
    subscribeRevalidation(generatedKey, (force) => {
      revalidate(fullOpts, args, undefined, force);
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
  const pollWhile = (
    target: Window | Document,
    events: string[],
    isActive: () => boolean,
  ): void => {
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
    if (fullOpts.refreshWhenBlurred) {
      pollWhile(window, ['blur', 'focus'], () => !document.hasFocus());
    }
    if (fullOpts.refreshWhenOffline) {
      pollWhile(window, ['offline', 'online'], () => !navigator.onLine);
    }
    if (fullOpts.refreshWhenHidden) {
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

  const listen = (target: Window | Document, event: string, listener: () => void): void => {
    target.addEventListener(event, listener, false);
    cleanups.push(() => {
      target.removeEventListener(event, listener, false);
    });
  };

  // Registers a focus event for revalidation.
  if (fullOpts.revalidateOnFocus) {
    listen(window, 'focus', onRevalidate);
  }

  // Registers a online event for revalidation.
  if (fullOpts.revalidateOnNetwork) {
    listen(window, 'online', onRevalidate);
  }

  // Registers a visibility change event for revalidation.
  if (fullOpts.revalidateOnVisibility) {
    listen(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        onRevalidate();
      }
    });
  }

  return cleanups;
}

interface Registration {
  count: number;
  cleanups: Cleanup[];
}

export default function createSWRStore<T, P extends any[] = []>(
  options: SWRStoreOptions<T, P>,
): SWRStore<T, P> {
  const id = `SWRStore-${getIndex()}`;
  const defaults = getDefaultConfig<T, P>();
  // The default key includes the store id, so two stores called with the
  // same arguments do not share a cache entry.
  defaults.key = (...args: P): string => `${id}:${JSON.stringify(args)}`;

  const fullOpts: SWRFullOptions<T, P> = {
    ...options,
    ...withDefaults(defaults, options),
  };

  // Every store counts its own subscribers per key, and starts and stops its
  // own revalidation sources. Other stores or global subscribers on the same
  // key do not affect it.
  const registrations = new Map<string, Registration>();

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
        registration = {
          count: 0,
          cleanups: register(generatedKey, fullOpts, args),
        };
        registrations.set(generatedKey, registration);
      }
      registration.count += 1;
      const current = registration;

      const unsubscribe = subscribe(generatedKey, listener);
      let active = true;
      return () => {
        if (!active) {
          return;
        }
        active = false;
        unsubscribe();
        current.count -= 1;
        if (current.count === 0) {
          for (const cleanup of current.cleanups) {
            cleanup();
          }
          registrations.delete(generatedKey);
        }
      };
    },
  };
}
