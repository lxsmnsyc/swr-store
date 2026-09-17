import type { SWREntry, SWRPending, SWRResult } from './cache/mutation-cache';
import {
  getLastWriteVersion,
  getMutation,
  nextVersion,
  pinKey,
  setMutation,
  setMutationDeferred,
  unpinKey,
} from './cache/mutation-cache';
import { setRevalidation, subscribeRevalidation } from './cache/revalidation-cache';
import type { SWRFullOptions } from './default-config';
import getDefaultConfig from './default-config';
import type { Fetch } from './fetches';
import { cancelFetch, fetches } from './fetches';
import { mutate, setResult, subscribe, trigger } from './global';
import IS_CLIENT, { HAS_DOCUMENT, HAS_WINDOW_EVENTS } from './is-client';
import createLazyPromise from './lazy-promise';
import reportUserError from './report-error';
import retry from './retry';
import { setServerRead } from './server-read';
import type { SWRGetOptions, SWRStore, SWRStoreOptions } from './types';

// Pending entries written for a key's first load, before it had any data.
// Hydration replaces only these. A pending entry from an expired refetch or
// from `setResult` holds newer work, so hydration keeps it.
const FIRST_LOADS = new WeakSet<SWREntry<unknown>>();

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

// The server has no cache, so every read is on its own. Initial data is
// returned as is. Anything else gets a pending result whose fetch only starts
// once something waits on it, so a render that only checks the status does
// not send a request.
function readOnServer<T, P extends any[] = []>(
  fullOpts: SWRFullOptions<T, P>,
  args: P,
  initialData: T | undefined,
): SWRResult<T> {
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

// Reads the cache for `args` and fetches when the cache is missing, stale or
// expired. With `force`, it fetches even when the cache is fresh.
function revalidate<T, P extends any[] = []>(
  fullOpts: SWRFullOptions<T, P>,
  args: P,
  opts?: SWRGetOptions<T>,
  force = false,
): SWRResult<T> {
  const { revalidate: shouldRevalidate, initialData } = withDefaults<SWRGetOptions<T>>(
    {
      revalidate: true,
      initialData: fullOpts.initialData,
    },
    opts,
  );
  if (!IS_CLIENT) {
    return readOnServer(fullOpts, args, initialData);
  }

  const generatedKey = fullOpts.key(...args);
  const now = Date.now();

  const currentMutation = getMutation<T>(generatedKey);

  // Initial data is only a placeholder. It is returned until a fetch fills
  // the cache, and never counts as fresh.
  const placeholder: SWRResult<T> | undefined =
    !currentMutation && initialData !== undefined
      ? { data: initialData, status: 'success' }
      : undefined;

  const running = fetches.get(generatedKey) as Fetch<T> | undefined;
  const cached = currentMutation?.result ?? placeholder ?? running?.result;

  if (cached && !shouldRevalidate) {
    return cached;
  }

  if (currentMutation && !force && currentMutation.timestamp + fullOpts.freshAge > now) {
    return currentMutation.result;
  }

  // Reads share the running fetch instead of starting another. A forced
  // revalidation replaces it, unless it already started after the last write.
  if (running && cached) {
    const startedAfterWrite = currentMutation?.isValidating ?? true;
    if (!force || startedAfterWrite) {
      return cached;
    }
  }

  const pendingRetry = retry(async () => fullOpts.get(...args), {
    count: fullOpts.maxRetryCount,
    interval: fullOpts.maxRetryInterval,
  });
  const pendingData = pendingRetry.resolvable.promise;
  const result: SWRPending<T> = {
    data: pendingData,
    status: 'pending',
  };
  const fetch: Fetch<T> = { retry: pendingRetry, result, startedAt: now };
  fetches.set(generatedKey, fetch);
  pinKey(generatedKey);

  // The old fetch stops retrying, and its promise settles with the new one,
  // so whoever waits on it still gets data.
  running?.retry.cancel(pendingData);

  let returned: SWRResult<T>;
  if (
    currentMutation &&
    currentMutation.result.status !== 'failure' &&
    currentMutation.timestamp + fullOpts.freshAge + fullOpts.staleAge > now
  ) {
    // Stale: keep the cached result while the fetch runs. A failure has no
    // stale time, so a retry shows as pending instead of the old error.
    returned = currentMutation.result;
    setMutationDeferred(generatedKey, { ...currentMutation, isValidating: true });
  } else if (currentMutation) {
    // Expired: the cached result is replaced by the pending one.
    returned = result;
    setMutationDeferred(generatedKey, { result, timestamp: now, isValidating: true });
  } else {
    // No entry: a placeholder stays out of the cache until the fetch settles.
    returned = placeholder ?? result;
    if (!placeholder) {
      const entry: SWREntry<T> = { result, timestamp: now, isValidating: true };
      FIRST_LOADS.add(entry);
      setMutationDeferred(generatedKey, entry);
    }
  }

  // Any write after this point is newer than the fetch, and wins over it.
  const version = nextVersion();

  const settle = (write: (latest: SWREntry<T> | undefined) => SWREntry<T>): void => {
    if (fetches.get(generatedKey) === fetch) {
      fetches.delete(generatedKey);
    }
    try {
      if (getLastWriteVersion(generatedKey) <= version) {
        setMutation(generatedKey, write(getMutation<T>(generatedKey)));
      }
    } catch (error) {
      // A throwing listener must not keep the key pinned forever.
      reportUserError(error);
    } finally {
      unpinKey(generatedKey);
    }
  };

  pendingData.then(
    (data) => {
      settle((latest) => {
        let isSame = false;
        try {
          isSame =
            latest?.result.status === 'success' && fullOpts.compare(latest.result.data, data);
        } catch (error) {
          // A throwing `compare` counts as different data, so the entry still
          // gets the fetched data and stops validating.
          reportUserError(error);
        }
        // Equal data keeps the cached result object, so subscribers that
        // compare results do not update.
        if (isSame && latest) {
          return { result: latest.result, timestamp: Date.now(), isValidating: false };
        }
        return {
          result: { data, status: 'success' },
          timestamp: Date.now(),
          isValidating: false,
        };
      });
    },
    (error: unknown) => {
      settle(() => ({
        result: { data: error, status: 'failure' },
        timestamp: Date.now(),
        isValidating: false,
      }));
    },
  );

  return returned;
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

  // Register polling interval
  if (fullOpts.refreshInterval != null && fullOpts.refreshInterval > 0) {
    const { refreshInterval } = fullOpts;

    // Each state needs its own events. Where they are missing, such as in
    // React Native or a web worker, that state is left out.
    const states: { target: EventTarget; events: string[]; isActive: () => boolean }[] = [];
    if (fullOpts.refreshWhenBlurred && HAS_WINDOW_EVENTS && HAS_DOCUMENT) {
      states.push({
        target: window,
        events: ['blur', 'focus'],
        isActive: () => !document.hasFocus(),
      });
    }
    if (fullOpts.refreshWhenOffline && HAS_WINDOW_EVENTS) {
      states.push({
        target: window,
        events: ['offline', 'online'],
        isActive: () => !navigator.onLine,
      });
    }
    if (fullOpts.refreshWhenHidden && HAS_DOCUMENT) {
      states.push({
        target: document,
        events: ['visibilitychange'],
        isActive: () => document.visibilityState !== 'visible',
      });
    }

    // When none of the chosen states can be detected here, polling runs all
    // the time, as if no state was chosen.
    if (states.length > 0) {
      // One interval runs while the page is in any of the states. The check
      // runs on every related event and once at the start, so polling begins
      // right away when the page is already in one of them.
      let interval: ReturnType<typeof setInterval> | undefined;
      const update = (): void => {
        const isActive = states.some((state) => state.isActive());
        if (isActive && interval === undefined) {
          interval = setInterval(onRevalidate, refreshInterval);
        } else if (!isActive && interval !== undefined) {
          clearInterval(interval);
          interval = undefined;
        }
      };
      for (const state of states) {
        for (const event of state.events) {
          state.target.addEventListener(event, update, false);
        }
      }
      update();
      cleanups.push(() => {
        for (const state of states) {
          for (const event of state.events) {
            state.target.removeEventListener(event, update, false);
          }
        }
        clearInterval(interval);
      });
    } else {
      const interval = setInterval(onRevalidate, refreshInterval);
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
  const fullOpts: SWRFullOptions<T, P> = {
    ...options,
    ...withDefaults(getDefaultConfig<T>(), options),
  };

  // Every store counts its own subscribers per key, and starts and stops its
  // own revalidation sources. Other stores or global subscribers on the same
  // key do not affect it.
  const registrations = new Map<string, Registration<P>>();

  const store: SWRStore<T, P> = {
    getKey: (args) => fullOpts.key(...args),
    trigger: (args) => {
      trigger(fullOpts.key(...args));
    },
    mutate: (args, value, mutateOptions) => {
      mutate(
        fullOpts.key(...args),
        value,
        withDefaults({ compare: fullOpts.compare }, mutateOptions),
      );
    },
    setResult: (args, result, mutateOptions) => {
      setResult(
        fullOpts.key(...args),
        result,
        withDefaults({ compare: fullOpts.compare }, mutateOptions),
      );
    },
    hydrate: (args, data) => {
      // `null` is data, so only `undefined` falls back to the store option.
      // oxlint-disable-next-line typescript/prefer-nullish-coalescing
      const value = data === undefined ? fullOpts.initialData : data;
      // The server has no cache to write to.
      if (!IS_CLIENT || value === undefined) {
        return;
      }
      const generatedKey = fullOpts.key(...args);
      // An entry is kept, unless it is pending on the key's first load. The
      // server's data is ready then, so that fetch stops.
      const current = getMutation<T>(generatedKey);
      if (current && !FIRST_LOADS.has(current)) {
        return;
      }
      cancelFetch(generatedKey, Promise.resolve(value));
      // Hydration can happen while a UI library renders, so subscribers are
      // notified in a microtask.
      setMutationDeferred(generatedKey, {
        result: { data: value, status: 'success' },
        timestamp: Date.now(),
        isValidating: false,
      });
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

  setServerRead(store, (args, opts) => {
    const { initialData } = withDefaults<SWRGetOptions<T>>(
      { initialData: fullOpts.initialData },
      opts,
    );
    return readOnServer(fullOpts, args, initialData);
  });

  return store;
}
