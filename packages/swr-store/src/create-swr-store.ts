import type { MutationPending, MutationResult } from './cache/mutation-cache';
import { getMutation, getMutationListenerSize, setMutation } from './cache/mutation-cache';
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

function revalidate<T, P extends any[] = []>(
  fullOpts: SWRFullOptions<T, P>,
  args: P,
  opts?: SWRGetOptions<T>,
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

  if (currentMutation) {
    if (!shouldRevalidate) {
      return currentMutation.result;
    }
    if (isPlaceholder) {
      // A fetch for this key is already running and will fill the cache.
      if (retries.has(generatedKey)) {
        return currentMutation.result;
      }
    } else if (currentMutation.timestamp + fullOpts.freshAge > timestamp) {
      // If mutation is still fresh, return mutation
      return currentMutation.result;
    }

    // We have to assume that if the request is no longer fresh
    // and the request is still pending, we need to cancel it
    // specially if it's retrying.
    if (currentMutation.result.status === 'pending') {
      const previousRetry = retries.get(generatedKey);

      if (previousRetry) {
        previousRetry.cancel();
      }
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

  // Capture result
  const result: MutationPending<T> = {
    data: pendingData,
    status: 'pending',
  };

  // Watch for promise resolutions
  // to update cache data
  const clearRetry = (): void => {
    if (retries.get(generatedKey) === pendingRetry) {
      retries.delete(generatedKey);
    }
  };

  pendingData.then(
    (data) => {
      clearRetry();
      const mutation = getMutation<T>(generatedKey);

      const shouldUpdate = (): boolean => {
        // Case 1: There's no mutation
        if (mutation == null) {
          return true;
        }

        // Case 2: Timestamp expired
        if (mutation.timestamp > timestamp) {
          return false;
        }

        // Case 3: There's a stale data
        if (mutation.result.status === 'success') {
          // Deep compare stale data
          return !fullOpts.compare(mutation.result.data, data);
        }

        // Always update
        return true;
      };

      if (shouldUpdate()) {
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
      }
    },
    (data: unknown) => {
      clearRetry();
      const mutation = getMutation<T>(generatedKey);

      const shouldUpdate = (): boolean => {
        // Case 1: There's no mutation
        if (mutation == null) {
          return true;
        }

        // Case 2: Timestamp expired
        if (mutation.timestamp > timestamp) {
          return false;
        }

        // Always update
        return true;
      };

      if (shouldUpdate()) {
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
      }
    },
  );

  // If there's an existing mutation
  // and mutation is stale
  // update timestamp and return
  if (
    currentMutation &&
    currentMutation.timestamp + fullOpts.freshAge + fullOpts.staleAge > timestamp
  ) {
    // Updating this means that the freshness or the staleness
    // of a mutation resets
    currentMutation.timestamp = timestamp;
    currentMutation.isValidating = true;
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
type Cleanups = Cleanup[];
type Subscribe = () => Cleanup;

// This lazy registration allows manageable
// global source subscriptions by performing
// reference-counting.
function lazyRegister<T, P extends any[] = []>(
  cleanups: Map<string, Cleanups>,
  generatedKey: string,
  fullOpts: SWRFullOptions<T, P>,
  args: P,
): void {
  // If there are listeners, it means
  // that the store has already made subscriptions
  if (getMutationListenerSize(generatedKey) > 0) {
    return;
  }

  // Create cleanup stack
  const currentCleanups: Cleanups = [];

  const subscription = (sub: Subscribe): void => {
    currentCleanups.push(sub());
  };

  const onRevalidate = (): void => {
    setRevalidation(generatedKey, true);
  };
  subscription(() => {
    const innerRevalidate = (flag: boolean): void => {
      revalidate(fullOpts, args, {
        shouldRevalidate: flag,
      });
    };
    return subscribeRevalidation(generatedKey, innerRevalidate);
  });

  // Only register on client-side
  if (IS_CLIENT) {
    // Register polling interval
    if (fullOpts.refreshInterval != null) {
      if (fullOpts.refreshWhenBlurred) {
        subscription(() => {
          let interval: undefined | number;

          const enter = (): void => {
            window.clearInterval(interval);
            interval = window.setInterval(onRevalidate, fullOpts.refreshInterval);
          };
          const exit = (): void => {
            window.clearInterval(interval);
            interval = undefined;
          };

          window.addEventListener('blur', enter, false);
          window.addEventListener('focus', exit, false);

          return () => {
            window.removeEventListener('blur', enter, false);
            window.removeEventListener('focus', exit, false);
            window.clearInterval(interval);
          };
        });
      }
      if (fullOpts.refreshWhenOffline) {
        subscription(() => {
          let interval: undefined | number;

          const enter = (): void => {
            window.clearInterval(interval);
            interval = window.setInterval(onRevalidate, fullOpts.refreshInterval);
          };
          const exit = (): void => {
            window.clearInterval(interval);
            interval = undefined;
          };

          window.addEventListener('offline', enter, false);
          window.addEventListener('online', exit, false);

          return () => {
            window.removeEventListener('offline', enter, false);
            window.removeEventListener('online', exit, false);
            window.clearInterval(interval);
          };
        });
      }
      if (fullOpts.refreshWhenHidden) {
        subscription(() => {
          let interval: undefined | number;

          const onVisibility = (): void => {
            window.clearInterval(interval);
            if (document.visibilityState === 'visible') {
              interval = undefined;
            } else {
              interval = window.setInterval(onRevalidate, fullOpts.refreshInterval);
            }
          };

          document.addEventListener('visibilitychange', onVisibility, false);

          return () => {
            document.removeEventListener('visibilitychange', onVisibility, false);
            window.clearInterval(interval);
          };
        });
      }
      if (
        !(fullOpts.refreshWhenHidden || fullOpts.refreshWhenBlurred || fullOpts.refreshWhenOffline)
      ) {
        subscription(() => {
          const interval = window.setInterval(onRevalidate, fullOpts.refreshInterval);

          return () => {
            window.clearInterval(interval);
          };
        });
      }
    }

    // Registers a focus event for revalidation.
    if (fullOpts.revalidateOnFocus) {
      subscription(() => {
        window.addEventListener('focus', onRevalidate, false);

        return () => {
          window.removeEventListener('focus', onRevalidate, false);
        };
      });
    }

    // Registers a online event for revalidation.
    if (fullOpts.revalidateOnNetwork) {
      subscription(() => {
        window.addEventListener('online', onRevalidate, false);

        return () => {
          window.removeEventListener('online', onRevalidate, false);
        };
      });
    }

    // Registers a visibility change event for revalidation.
    if (fullOpts.revalidateOnVisibility) {
      subscription(() => {
        const onVisible = (): void => {
          if (document.visibilityState === 'visible') {
            onRevalidate();
          }
        };

        window.addEventListener('visibilitychange', onVisible, false);

        return () => {
          window.removeEventListener('visibilitychange', onVisible, false);
        };
      });
    }
  }

  cleanups.set(generatedKey, currentCleanups);
}

function lazyUnregister(cleanups: Map<string, Cleanups>, generatedKey: string): void {
  if (getMutationListenerSize(generatedKey) === 0) {
    const actualCleanups = cleanups.get(generatedKey);
    if (actualCleanups) {
      for (let i = 0, len = actualCleanups.length; i < len; i += 1) {
        actualCleanups[i]();
      }
      cleanups.delete(generatedKey);
    }
  }
}

export default function createSWRStore<T, P extends any[] = []>(
  options: SWRStoreOptions<T, P>,
): SWRStore<T, P> {
  const fullOpts: SWRFullOptions<T, P> = {
    ...options,
    ...withDefaults(getDefaultConfig<T, P>(), options),
  };
  const cleanups = new Map<string, Cleanups>();

  return {
    id: `SWRStore-${getIndex()}`,
    trigger: (args, shouldRevalidate = true) => {
      const generatedKey = fullOpts.key(...args);
      trigger(generatedKey, shouldRevalidate);
    },
    mutate: (args, data, shouldRevalidate = true, compare = fullOpts.compare) => {
      const generatedKey = fullOpts.key(...args);
      mutate(generatedKey, data, shouldRevalidate, compare);
    },
    // This function revalidates the mutation cache
    // through reactive process
    get: (args, opts) => revalidate(fullOpts, args, opts),
    subscribe: (args, listener) => {
      const generatedKey = fullOpts.key(...args);

      // Setup lazy global registration
      lazyRegister(cleanups, generatedKey, fullOpts, args);

      const unsubscribe = subscribe(generatedKey, listener);
      return () => {
        unsubscribe();
        // Attempt lazy unregistration
        lazyUnregister(cleanups, generatedKey);
      };
    },
  };
}
