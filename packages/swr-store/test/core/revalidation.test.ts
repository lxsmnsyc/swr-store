// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSWRStore } from '../../src';
import { uniqueKey } from '../utils';

afterEach(() => {
  vi.useRealTimers();
});

function createStore(options: {
  revalidateOnFocus?: boolean;
  revalidateOnNetwork?: boolean;
  refreshInterval?: number;
}) {
  const key = uniqueKey('events');
  const get = vi.fn(async () => 'value');
  const store = createSWRStore<string>({
    key: () => key,
    get,
    freshAge: 0,
    staleAge: 0,
    ...options,
  });
  return { get, store };
}

describe('automatic revalidation', () => {
  it('revalidates on focus only while subscribed', async () => {
    const { get, store } = createStore({ revalidateOnFocus: true });
    await store.get([]).data;

    window.dispatchEvent(new Event('focus'));
    expect(get).toHaveBeenCalledTimes(1);

    const unsubscribe = store.subscribe([], vi.fn());
    window.dispatchEvent(new Event('focus'));
    expect(get).toHaveBeenCalledTimes(2);

    unsubscribe();
    window.dispatchEvent(new Event('focus'));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('revalidates when the network comes back', async () => {
    const { get, store } = createStore({ revalidateOnNetwork: true });
    await store.get([]).data;

    const unsubscribe = store.subscribe([], vi.fn());
    window.dispatchEvent(new Event('online'));
    expect(get).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('polls on the refresh interval', async () => {
    const { get, store } = createStore({ refreshInterval: 1000 });
    await store.get([]).data;

    vi.useFakeTimers();
    const unsubscribe = store.subscribe([], vi.fn());
    vi.advanceTimersByTime(1000);
    expect(get).toHaveBeenCalledTimes(2);

    unsubscribe();
    vi.advanceTimersByTime(5000);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
