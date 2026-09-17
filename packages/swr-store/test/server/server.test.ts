import { describe, expect, it, vi } from 'vitest';
import { createSWRStore, mutate, subscribe, trigger } from '../../src';
import { uniqueKey } from '../utils';

describe('on the server', () => {
  it('does not share results between reads of the same key', async () => {
    const key = uniqueKey('server-shared');
    const get = vi.fn(async (user: string) => `data of ${user}`);
    const first = createSWRStore<string, [string]>({ key: () => key, get });
    const second = createSWRStore<string, [string]>({ key: () => key, get });

    const alice = first.get(['alice']);
    expect(alice.status).toBe('pending');
    await expect(alice.data).resolves.toBe('data of alice');

    const bob = second.get(['bob']);
    expect(bob.status).toBe('pending');
    await expect(bob.data).resolves.toBe('data of bob');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('returns initialData without fetching', () => {
    const key = uniqueKey('server-initial');
    const get = vi.fn(async () => 'fetched');
    const store = createSWRStore<string>({ key: () => key, get });

    store.hydrate([], 'server');
    expect(store.get([], { initialData: 'initial' })).toEqual({
      status: 'success',
      data: 'initial',
    });
    expect(get).not.toHaveBeenCalled();

    // Hydrating did not write to a shared cache.
    expect(store.get([]).status).toBe('pending');
  });

  it('ignores mutate and does not notify subscribers', () => {
    const key = uniqueKey('server-mutate');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'fetched',
    });

    const listener = vi.fn();
    const unsubscribe = subscribe(key, listener);
    const storeListener = vi.fn();
    const unsubscribeStore = store.subscribe([], storeListener);

    mutate(key, 'mutated');
    store.mutate([], 'mutated');
    const updater = vi.fn((previous: string | undefined) => `${previous!}!`);
    store.mutate([], updater);
    trigger(key);

    expect(updater).not.toHaveBeenCalled();

    expect(listener).not.toHaveBeenCalled();
    expect(storeListener).not.toHaveBeenCalled();
    expect(store.get([]).status).toBe('pending');
    unsubscribe();
    unsubscribeStore();
  });

  it('does not retry unless maxRetryCount is set', async () => {
    const error = new Error('failed');
    const get = vi.fn(async () => {
      throw error;
    });
    const store = createSWRStore<string>({
      key: () => uniqueKey('server-retry'),
      get,
    });

    await expect(store.get([]).data).rejects.toBe(error);
    expect(get).toHaveBeenCalledTimes(1);

    const retrying = createSWRStore<string>({
      key: () => uniqueKey('server-retry'),
      get,
      maxRetryCount: 1,
      maxRetryInterval: 10,
    });
    await expect(retrying.get([]).data).rejects.toBe(error);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('only fetches once the pending result is awaited', async () => {
    const get = vi.fn(async () => 'value');
    const store = createSWRStore<string>({
      key: () => uniqueKey('server-lazy'),
      get,
    });

    const result = store.get([]);
    expect(result.status).toBe('pending');
    expect(get).not.toHaveBeenCalled();

    await expect(result.data).resolves.toBe('value');
    await expect(result.data).resolves.toBe('value');
    expect(get).toHaveBeenCalledTimes(1);
  });
});
