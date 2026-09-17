import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSWRStore, mutate, subscribe, trigger } from '../../src';
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

  it('derives the cache key from the arguments by default', async () => {
    const get = vi.fn(async (id: number) => id * 2);
    const store = createSWRStore<number, [number]>({ get });
    const other = createSWRStore<number, [number]>({ get });

    const id = Date.now();
    await store.get([id]).data;

    // A second store with the same arguments reads the shared cache.
    expect(other.get([id])).toEqual({ status: 'success', data: id * 2 });
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
    expect(store.get([], { shouldRevalidate: false })).toEqual({
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

  it('skips revalidation when shouldRevalidate is false', async () => {
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

    expect(store.get([], { shouldRevalidate: false })).toEqual({
      status: 'success',
      data: 'value',
    });
    expect(get).toHaveBeenCalledTimes(1);
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
    const settled = store.get([], { shouldRevalidate: false });

    const listener = vi.fn();
    const unsubscribe = store.subscribe([], listener);

    vi.setSystemTime(Date.now() + 10);
    store.get([]);
    await flush();

    expect(listener).not.toHaveBeenCalled();
    expect(store.get([], { shouldRevalidate: false })).toBe(settled);
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
    expect(store.get([], { shouldRevalidate: false })).toEqual({
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

  it('writes initialData to the cache when hydrate is set', () => {
    const key = uniqueKey('hydrate');
    const get = vi.fn(async () => 'fetched');
    const store = createSWRStore<string>({ key: () => key, get });

    store.get([], { initialData: 'initial', hydrate: true });

    expect(store.get([])).toEqual({ status: 'success', data: 'initial' });
    expect(get).not.toHaveBeenCalled();
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
    store.mutate([], { status: 'success', data: 'mutated' }, false);

    deferred.resolve('fetched');
    await flush();

    expect(store.get([], { shouldRevalidate: false })).toEqual({
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
    store.mutate([], { status: 'success', data: 'other' }, false);
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
    mutate(key, { status: 'success', data: 'mutated' }, false);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get([], { shouldRevalidate: false })).toEqual({
      status: 'success',
      data: 'mutated',
    });
    unsubscribe();
  });

  it('skips notifying when mutate writes equal data', () => {
    const key = uniqueKey('mutate-equal');
    const listener = vi.fn();
    const unsubscribe = subscribe(key, listener);

    mutate(key, { status: 'success', data: { id: 1 } }, false);
    mutate(key, { status: 'success', data: { id: 1 } }, false);
    expect(listener).toHaveBeenCalledTimes(1);

    mutate(key, { status: 'success', data: { id: 1 } }, false, () => false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
