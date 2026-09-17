import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SWREntry } from '../../src';
import { createSWRStore, mutate, setCacheSize, setResult, subscribe, trigger } from '../../src';
import { createDeferred, flush, uniqueKey } from '../utils';

afterEach(() => {
  vi.useRealTimers();
});

describe('createSWRStore', () => {
  it('returns a pending result, then the fetched data', async () => {
    const key = uniqueKey('fetch');
    const store = createSWRStore<string, [string]>({
      key: () => key,
      get: async (id) => `data-${id}`,
    });

    const first = store.get(['a']);
    expect(first.status).toBe('pending');
    await expect(first.data).resolves.toBe('data-a');

    expect(store.get(['a'])).toEqual({ status: 'success', data: 'data-a' });
  });

  it('shares the cache between stores with the same custom key', async () => {
    const key = uniqueKey('shared');
    const get = vi.fn(async () => 'value');
    const store = createSWRStore<string>({ key: () => key, get });
    const other = createSWRStore<string>({ key: () => key, get });

    await store.get([]).data;

    expect(other.get([])).toEqual({ status: 'success', data: 'value' });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('deduplicates reads while the cache is fresh', () => {
    const key = uniqueKey('dedupe');
    const get = vi.fn(async () => 'value');
    const store = createSWRStore<string>({ key: () => key, get });

    const first = store.get([]);
    const second = store.get([]);

    expect(second).toBe(first);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('returns stale data while revalidating', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const key = uniqueKey('stale');
    let count = 0;
    const store = createSWRStore<number>({
      key: () => key,
      get: async () => {
        count += 1;
        return count;
      },
      freshAge: 100,
      staleAge: 1000,
    });

    await store.get([]).data;
    expect(store.get([])).toEqual({ status: 'success', data: 1 });

    vi.setSystemTime(Date.now() + 500);

    // Stale: the old data comes back and a fetch starts in the background.
    expect(store.get([])).toEqual({ status: 'success', data: 1 });
    await flush();
    expect(store.get([], { revalidate: false })).toEqual({
      status: 'success',
      data: 2,
    });
  });

  it('goes back to pending once the cache expires', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const key = uniqueKey('expired');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'value',
      freshAge: 100,
      staleAge: 100,
    });

    await store.get([]).data;
    vi.setSystemTime(Date.now() + 1000);

    expect(store.get([]).status).toBe('pending');
  });

  it('skips revalidation when revalidate is false', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const key = uniqueKey('no-revalidate');
    const get = vi.fn(async () => 'value');
    const store = createSWRStore<string>({
      key: () => key,
      get,
      freshAge: 0,
    });

    await store.get([]).data;
    vi.setSystemTime(Date.now() + 10);

    expect(store.get([], { revalidate: false })).toEqual({
      status: 'success',
      data: 'value',
    });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('stores fetched data and stops validating when compare throws', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const key = uniqueKey('compare-throws');
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    let count = 0;
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => {
        count += 1;
        return `v${count}`;
      },
      freshAge: 0,
      compare: () => {
        throw new Error('compare failed');
      },
    });

    await store.get([]).data;
    vi.setSystemTime(Date.now() + 10);
    store.get([]);
    await flush();

    expect(store.get([], { revalidate: false })).toEqual({ status: 'success', data: 'v2' });
    expect(reportError).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('keeps the old result when the new data is deeply equal', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const key = uniqueKey('compare');
    const store = createSWRStore<{ id: number }>({
      key: () => key,
      get: async () => ({ id: 1 }),
      freshAge: 0,
    });

    await store.get([]).data;
    const settled = store.get([], { revalidate: false });

    const listener = vi.fn<(mutation: SWREntry<{ id: number }>) => void>();
    const unsubscribe = store.subscribe([], listener);

    vi.setSystemTime(Date.now() + 10);
    store.get([]);
    await flush();

    // Subscribers only see the revalidation start and end, with the same result.
    expect(listener.mock.calls.map(([mutation]) => mutation.isValidating)).toEqual([true, false]);
    for (const [mutation] of listener.mock.calls) {
      expect(mutation.result).toBe(settled);
    }
    expect(store.get([], { revalidate: false })).toBe(settled);
    unsubscribe();
  });

  it('stores a failure once the retries run out', async () => {
    const key = uniqueKey('failure');
    const error = new Error('failed');
    const get = vi.fn(async () => {
      throw error;
    });
    const store = createSWRStore<string>({
      key: () => key,
      get,
      maxRetryCount: 2,
      maxRetryInterval: 10,
    });

    await expect(store.get([]).data).rejects.toBe(error);
    expect(get).toHaveBeenCalledTimes(3);
    expect(store.get([], { revalidate: false })).toEqual({
      status: 'failure',
      data: error,
    });
  });

  it('retries until the fetch succeeds', async () => {
    const key = uniqueKey('retry');
    let attempts = 0;
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error('not yet');
        }
        return 'done';
      },
      maxRetryInterval: 10,
    });

    await expect(store.get([]).data).resolves.toBe('done');
    expect(attempts).toBe(3);
  });

  it('returns initialData while the first fetch runs', async () => {
    const key = uniqueKey('initial');
    const deferred = createDeferred<string>();
    const get = vi.fn(async () => deferred.promise);
    const store = createSWRStore<string>({ key: () => key, get });

    expect(store.get([], { initialData: 'initial' })).toEqual({
      status: 'success',
      data: 'initial',
    });
    // The fetch is already running, so a second read does not start another.
    expect(store.get([], { initialData: 'initial' })).toEqual({
      status: 'success',
      data: 'initial',
    });
    expect(get).toHaveBeenCalledTimes(1);

    deferred.resolve('fetched');
    await flush();

    expect(store.get([], { initialData: 'initial' })).toEqual({
      status: 'success',
      data: 'fetched',
    });
  });

  it('accepts falsy initialData', () => {
    const key = uniqueKey('falsy');
    const store = createSWRStore<number>({
      key: () => key,
      get: async () => 1,
    });

    expect(store.get([], { initialData: 0 })).toEqual({
      status: 'success',
      data: 0,
    });
  });

  it('writes hydrated data to the cache', () => {
    const key = uniqueKey('hydrate');
    const get = vi.fn(async () => 'fetched');
    const store = createSWRStore<string>({ key: () => key, get });

    store.hydrate([], 'server');

    expect(store.get([])).toEqual({ status: 'success', data: 'server' });
    expect(get).not.toHaveBeenCalled();
  });

  it('keeps a settled entry when hydrating', async () => {
    const key = uniqueKey('hydrate-settled');
    const store = createSWRStore<string>({ key: () => key, get: async () => 'fetched' });

    await store.get([]).data;
    store.hydrate([], 'server');

    expect(store.get([], { revalidate: false })).toEqual({ status: 'success', data: 'fetched' });
  });

  it('replaces a pending entry when hydrating, and drops the running fetch', async () => {
    const key = uniqueKey('hydrate-pending');
    const deferred = createDeferred<string>();
    const store = createSWRStore<string>({ key: () => key, get: async () => deferred.promise });

    expect(store.get([]).status).toBe('pending');
    store.hydrate([], 'server');
    deferred.resolve('fetched');
    await flush();

    expect(store.get([], { revalidate: false })).toEqual({ status: 'success', data: 'server' });
  });

  it('falls back to the initialData option of the store', async () => {
    const key = uniqueKey('store-initial');
    const get = vi.fn(async () => 'fetched');
    const store = createSWRStore<string>({
      key: () => key,
      get,
      initialData: 'initial',
    });

    // An explicit `undefined` keeps the store option.
    expect(store.get([], { initialData: undefined })).toEqual({
      status: 'success',
      data: 'initial',
    });
    await flush();

    expect(get).toHaveBeenCalledTimes(1);
    expect(store.get([])).toEqual({ status: 'success', data: 'fetched' });
  });

  it('keeps the defaults for options set to undefined', () => {
    const key = uniqueKey('undefined-options');
    const get = vi.fn(async () => 'value');
    const store = createSWRStore<string>({
      key: () => key,
      get,
      freshAge: undefined,
    });

    store.get([]);
    store.get([]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('ignores a fetch that settles after a newer write', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const key = uniqueKey('race');
    const deferred = createDeferred<string>();
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => deferred.promise,
    });

    store.get([]);
    vi.setSystemTime(Date.now() + 10);
    store.mutate([], 'mutated', { revalidate: false });

    deferred.resolve('fetched');
    await flush();

    expect(store.get([], { revalidate: false })).toEqual({
      status: 'success',
      data: 'mutated',
    });
  });
});

describe('subscriptions', () => {
  it('notifies subscribers when the fetch settles', async () => {
    const key = uniqueKey('subscribe');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'value',
    });

    const listener = vi.fn();
    const unsubscribe = store.subscribe([], listener);
    await store.get([]).data;

    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        result: { status: 'success', data: 'value' },
      }),
    );

    unsubscribe();
    listener.mockClear();
    store.mutate([], 'other', { revalidate: false });
    expect(listener).not.toHaveBeenCalled();
  });

  it('revalidates subscribed stores on trigger', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const key = uniqueKey('trigger');
    const get = vi.fn(async () => 'value');
    const store = createSWRStore<string>({
      key: () => key,
      get,
      freshAge: 100,
    });

    const unsubscribe = store.subscribe([], vi.fn());
    await store.get([]).data;

    // Still fresh, so the trigger has nothing to do.
    store.trigger([]);
    expect(get).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 200);
    trigger(key);
    expect(get).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it('writes results through the global mutate', () => {
    const key = uniqueKey('mutate');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'fetched',
    });

    const listener = vi.fn();
    const unsubscribe = subscribe(key, listener);
    mutate(key, 'mutated', { revalidate: false });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get([], { revalidate: false })).toEqual({
      status: 'success',
      data: 'mutated',
    });
    unsubscribe();
  });

  it('skips notifying when mutate writes equal data', () => {
    const key = uniqueKey('mutate-equal');
    const listener = vi.fn();
    const unsubscribe = subscribe(key, listener);

    mutate(key, { id: 1 }, { revalidate: false });
    mutate(key, { id: 1 }, { revalidate: false });
    expect(listener).toHaveBeenCalledTimes(1);

    mutate(key, { id: 1 }, { revalidate: false, compare: () => false });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});

describe('setCacheSize', () => {
  it('removes the least recently used entries', async () => {
    setCacheSize(2);
    try {
      const prefix = uniqueKey('lru');
      const get = vi.fn(async (id: string) => id);
      const store = createSWRStore<string, [string]>({
        key: (id) => `${prefix}-${id}`,
        get,
      });

      await store.get(['a']).data;
      await store.get(['b']).data;
      store.get(['a']);
      await store.get(['c']).data;

      expect(store.get(['a'])).toEqual({ status: 'success', data: 'a' });
      // `b` was the least recently used entry, so it has to be fetched again.
      expect(store.get(['b']).status).toBe('pending');
    } finally {
      setCacheSize(1000);
    }
  });

  it('keeps entries that have subscribers', async () => {
    setCacheSize(1);
    try {
      const prefix = uniqueKey('lru-subscribed');
      const store = createSWRStore<string, [string]>({
        key: (id) => `${prefix}-${id}`,
        get: async (id) => id,
      });

      await store.get(['a']).data;
      const unsubscribe = store.subscribe(['a'], vi.fn());
      await store.get(['b']).data;

      expect(store.get(['a'], { revalidate: false })).toEqual({
        status: 'success',
        data: 'a',
      });
      unsubscribe();
    } finally {
      setCacheSize(1000);
    }
  });
});

describe('regressions', () => {
  it('settles a cancelled fetch with the fetch that replaced it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const key = uniqueKey('cancel');
    let fail = true;
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => {
        if (fail) {
          throw new Error('not yet');
        }
        return 'value';
      },
      freshAge: 0,
      staleAge: 0,
      maxRetryInterval: 60_000,
    });

    const first = store.get([]);
    await flush();

    fail = false;
    vi.setSystemTime(Date.now() + 10);
    store.get([]);

    await expect(first.data).resolves.toBe('value');
  });

  it('keeps the fetch that mutate starts, even in the same millisecond', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const key = uniqueKey('mutate-race');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'server',
    });

    const unsubscribe = store.subscribe([], vi.fn());
    await store.get([]).data;

    store.mutate([], 'optimistic');
    expect(store.get([], { revalidate: false })).toEqual({
      status: 'success',
      data: 'optimistic',
    });

    await flush();
    expect(store.get([], { revalidate: false })).toEqual({
      status: 'success',
      data: 'server',
    });
    unsubscribe();
  });
});

describe('notifications', () => {
  it('notifies about writes made by a read in a microtask', async () => {
    const key = uniqueKey('deferred');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'value',
    });
    const listener = vi.fn();
    const unsubscribe = store.subscribe([], listener);

    store.get([]);
    expect(listener).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('fetches once after mutate when stores share a key', async () => {
    const key = uniqueKey('mutate-shared');
    const get = vi.fn(async () => 'server');
    const first = createSWRStore<string>({ key: () => key, get });
    const second = createSWRStore<string>({ key: () => key, get });
    const unsubscribeFirst = first.subscribe([], vi.fn());
    const unsubscribeSecond = second.subscribe([], vi.fn());
    await first.get([]).data;
    get.mockClear();

    mutate(key, 'optimistic');

    expect(get).toHaveBeenCalledTimes(1);
    unsubscribeFirst();
    unsubscribeSecond();
  });
});

describe('fetch ordering', () => {
  it('shares a failing background fetch instead of starting another', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const key = uniqueKey('failing-refresh');
    let fail = false;
    const get = vi.fn(async () => {
      if (fail) {
        throw new Error('failed');
      }
      return 'value';
    });
    const store = createSWRStore<string>({
      key: () => key,
      get,
      freshAge: 100,
      maxRetryInterval: 50,
    });

    await store.get([]).data;
    fail = true;

    vi.setSystemTime(Date.now() + 200);
    store.get([]);
    expect(get).toHaveBeenCalledTimes(2);

    vi.setSystemTime(Date.now() + 200);
    store.get([]);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('keeps a write made in the same millisecond as a fetch start', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const key = uniqueKey('same-millisecond');
    const deferred = createDeferred<string>();
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => deferred.promise,
    });

    store.get([]);
    store.mutate([], 'mutated', { revalidate: false });
    deferred.resolve('fetched');
    await flush();

    expect(store.get([], { revalidate: false })).toEqual({
      status: 'success',
      data: 'mutated',
    });
  });

  it('shares the fetch started by a read with initialData', async () => {
    const key = uniqueKey('placeholder-share');
    const get = vi.fn(async () => 'value');
    const store = createSWRStore<string>({ key: () => key, get });

    store.get([], { initialData: 'initial' });
    const pending = store.get([]);

    expect(get).toHaveBeenCalledTimes(1);
    expect(pending.status).toBe('pending');
    await expect(pending.data).resolves.toBe('value');
  });

  it('counts freshness from when a fetch settles', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const key = uniqueKey('slow-fetch');
    const deferred = createDeferred<string>();
    const get = vi.fn(async () => deferred.promise);
    const store = createSWRStore<string>({
      key: () => key,
      get,
      freshAge: 1000,
      staleAge: 1000,
    });

    store.get([]);
    vi.setSystemTime(Date.now() + 2500);
    deferred.resolve('value');
    await flush();

    expect(store.get([])).toEqual({ status: 'success', data: 'value' });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('notifies once when a read and a write happen before the microtask', async () => {
    const key = uniqueKey('single-notify');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'value',
    });
    const listener = vi.fn();
    const unsubscribe = store.subscribe([], listener);

    store.get([]);
    store.mutate([], 'mutated', { revalidate: false });
    await flush();

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

describe('eviction', () => {
  it('keeps the entry of a key with a running fetch', async () => {
    setCacheSize(1);
    try {
      const prefix = uniqueKey('evict-running');
      const holder = createSWRStore<string>({
        key: () => `${prefix}-held`,
        get: async () => 'held',
      });
      await holder.get([]).data;
      const unsubscribe = holder.subscribe([], vi.fn());

      const deferred = createDeferred<string>();
      const get = vi.fn(async () => deferred.promise);
      const store = createSWRStore<string>({ key: () => `${prefix}-fetched`, get });

      store.get([]);
      holder.mutate([], 'other', { revalidate: false });
      expect(store.get([]).status).toBe('pending');
      expect(get).toHaveBeenCalledTimes(1);

      deferred.resolve('value');
      await flush();
      expect(store.get([], { revalidate: false })).toEqual({
        status: 'success',
        data: 'value',
      });
      unsubscribe();
    } finally {
      setCacheSize(1000);
    }
  });

  it('drops a fetch that started before a write whose entry was evicted', async () => {
    const prefix = uniqueKey('evict-version');
    const deferred = createDeferred<string>();
    const store = createSWRStore<string>({
      key: () => `${prefix}-a`,
      get: async () => deferred.promise,
    });
    const other = createSWRStore<string>({ key: () => `${prefix}-b`, get: async () => 'b' });

    store.get([]);
    store.mutate([], 'optimistic', { revalidate: false });
    setCacheSize(1);
    try {
      // The pinned key stays while its fetch runs, so it is evicted only after
      // this write lands on a full cache that no longer pins it.
      await other.get([]).data;
      deferred.resolve('old');
      await flush();
      expect(store.get([], { revalidate: false })).toEqual({
        status: 'success',
        data: 'optimistic',
      });
    } finally {
      setCacheSize(1000);
    }
  });
});

describe('notification details', () => {
  it('does not call a listener removed earlier in the same notification', () => {
    const key = uniqueKey('removed-listener');
    const calls: string[] = [];
    let unsubscribeB = (): void => undefined;
    const unsubscribeA = subscribe(key, () => {
      calls.push('a');
      unsubscribeB();
    });
    unsubscribeB = subscribe(key, () => {
      calls.push('b');
    });

    mutate(key, 'value', { revalidate: false });

    expect(calls).toEqual(['a']);
    unsubscribeA();
  });

  it('tells subscribers that validation ended when mutate writes equal data', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const key = uniqueKey('equal-mutate-validating');
    const deferred = createDeferred<string>();
    let first = true;
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => {
        if (first) {
          first = false;
          return 'value';
        }
        return deferred.promise;
      },
      freshAge: 10,
      staleAge: 10_000,
    });
    await store.get([]).data;
    const listener = vi.fn<(mutation: SWREntry<string>) => void>();
    const unsubscribe = store.subscribe([], listener);

    vi.setSystemTime(Date.now() + 100);
    store.get([]);
    await flush();
    store.mutate([], 'value', { revalidate: false });
    deferred.resolve('value');
    await flush();

    expect(listener.mock.calls.at(-1)?.[0].isValidating).toBe(false);
    unsubscribe();
  });

  it('shows a retry of a stale failure as pending', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const key = uniqueKey('stale-failure');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'value',
      freshAge: 10,
      staleAge: 10_000,
    });
    store.setResult([], { status: 'failure', data: new Error('failed') }, { revalidate: false });

    vi.setSystemTime(Date.now() + 100);
    expect(store.get([]).status).toBe('pending');
  });
});

describe('retry timing', () => {
  it('lets maxRetryInterval cap waits below 10 milliseconds', async () => {
    vi.useFakeTimers();
    const get = vi.fn(async () => {
      throw new Error('failed');
    });
    const store = createSWRStore<string>({
      key: () => uniqueKey('short-retry'),
      get,
      maxRetryCount: 5,
      maxRetryInterval: 2,
    });

    const result = store.get([]);
    if (result.status === 'pending') {
      result.data.catch(() => undefined);
    }
    await vi.advanceTimersByTimeAsync(10);

    expect(get).toHaveBeenCalledTimes(6);
    vi.useRealTimers();
  });
});

describe('user code errors', () => {
  it('keeps notifying and unpins the key when a listener throws', async () => {
    const reported: unknown[] = [];
    vi.stubGlobal('reportError', (error: unknown) => {
      reported.push(error);
    });
    setCacheSize(1);
    try {
      const prefix = uniqueKey('throwing-listener');
      const store = createSWRStore<string, [string]>({
        key: (id) => `${prefix}-${id}`,
        get: async (id) => id,
      });
      const calls: string[] = [];
      const unsubscribeThrowing = subscribe(store.getKey(['a']), () => {
        throw new Error('listener failed');
      });
      const unsubscribeNext = subscribe(store.getKey(['a']), () => {
        calls.push('next');
      });

      await store.get(['a']).data;
      // Every notification reached the second listener, and every error from
      // the first was reported instead of thrown.
      expect(calls.length).toBeGreaterThan(0);
      expect(reported).toHaveLength(calls.length);

      unsubscribeThrowing();
      unsubscribeNext();
      // With no subscribers and no running fetch, `a` can be evicted.
      await store.get(['b']).data;
      store.mutate(['c'], 'c', { revalidate: false });
      expect(store.get(['a'], { revalidate: false }).status).toBe('pending');
    } finally {
      setCacheSize(1000);
      vi.unstubAllGlobals();
    }
  });
});

describe('mutate with a pending result', () => {
  it('writes the outcome when no store fetches the key', async () => {
    const key = uniqueKey('mutate-pending');
    const deferred = createDeferred<string>();
    const listener = vi.fn<(mutation: SWREntry<string>) => void>();
    const unsubscribe = subscribe(key, listener);

    setResult(key, { status: 'pending', data: deferred.promise }, { revalidate: false });
    deferred.resolve('value');
    await flush();

    expect(listener.mock.lastCall?.[0].result).toEqual({ status: 'success', data: 'value' });
    unsubscribe();
  });

  it('keeps a newer write', async () => {
    const key = uniqueKey('mutate-pending-newer');
    const deferred = createDeferred<string>();
    const listener = vi.fn<(mutation: SWREntry<string>) => void>();
    const unsubscribe = subscribe(key, listener);

    setResult(key, { status: 'pending', data: deferred.promise }, { revalidate: false });
    mutate(key, 'newer', { revalidate: false });
    deferred.resolve('older');
    await flush();

    expect(listener.mock.lastCall?.[0].result).toEqual({ status: 'success', data: 'newer' });
    unsubscribe();
  });
});

describe('mutate values', () => {
  it('passes the cached data to an updater', async () => {
    const key = uniqueKey('mutate-updater');
    const store = createSWRStore<number>({ key: () => key, get: async () => 1 });

    await store.get([]).data;
    store.mutate([], (previous) => (previous ?? 0) + 1, { revalidate: false });

    expect(store.get([], { revalidate: false })).toEqual({ status: 'success', data: 2 });
  });

  it('passes undefined to an updater when the entry holds no data', () => {
    const key = uniqueKey('mutate-updater-empty');
    const updater = vi.fn((previous: number | undefined) => (previous ?? 0) + 1);

    mutate(key, updater, { revalidate: false });

    expect(updater).toHaveBeenCalledWith(undefined);
  });

  it('uses the store compare when the options leave it undefined', async () => {
    const key = uniqueKey('mutate-store-compare');
    const compare = vi.fn(() => true);
    const store = createSWRStore<string>({ key: () => key, get: async () => 'value', compare });

    await store.get([]).data;
    store.mutate([], 'other', { revalidate: false, compare: undefined });

    expect(compare).toHaveBeenCalled();
    expect(store.get([], { revalidate: false })).toEqual({ status: 'success', data: 'value' });
  });
});
