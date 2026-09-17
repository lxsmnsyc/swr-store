import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSWRStore, subscribe } from '../../src';
import { flush, uniqueKey } from '../utils';

afterEach(() => {
  vi.useRealTimers();
});

function createStore(options: {
  revalidateOnFocus?: boolean;
  revalidateOnNetwork?: boolean;
  refreshInterval?: number;
  refreshWhenHidden?: boolean;
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

describe('revalidation sources', () => {
  it('removes the listeners of every store that shares a key', async () => {
    const key = uniqueKey('shared-listeners');
    const get = vi.fn(async () => 'value');
    const options = {
      key: () => key,
      get,
      freshAge: 0,
      staleAge: 0,
      revalidateOnFocus: true,
    };
    const first = createSWRStore<string>(options);
    const second = createSWRStore<string>(options);
    await first.get([]).data;

    const unsubscribeFirst = first.subscribe([], vi.fn());
    const unsubscribeSecond = second.subscribe([], vi.fn());
    unsubscribeFirst();
    unsubscribeSecond();
    get.mockClear();

    window.dispatchEvent(new Event('focus'));
    expect(get).not.toHaveBeenCalled();
  });

  it('sets up listeners when a global subscriber came first', async () => {
    const { get, store } = createStore({ revalidateOnFocus: true });
    await store.get([]).data;

    const unsubscribeGlobal = subscribe(store.getKey([]), vi.fn());
    const unsubscribe = store.subscribe([], vi.fn());
    get.mockClear();

    window.dispatchEvent(new Event('focus'));
    expect(get).toHaveBeenCalledTimes(1);

    unsubscribe();
    unsubscribeGlobal();
  });

  it('only cleans up once when unsubscribe is called twice', async () => {
    const { get, store } = createStore({ revalidateOnFocus: true });
    await store.get([]).data;

    const unsubscribeFirst = store.subscribe([], vi.fn());
    const unsubscribeSecond = store.subscribe([], vi.fn());
    unsubscribeFirst();
    unsubscribeFirst();
    get.mockClear();

    window.dispatchEvent(new Event('focus'));
    expect(get).toHaveBeenCalledTimes(1);
    unsubscribeSecond();
  });

  it('starts polling right away when the page is already hidden', async () => {
    const { get, store } = createStore({ refreshInterval: 1000, refreshWhenHidden: true });
    await store.get([]).data;
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

    vi.useFakeTimers();
    const unsubscribe = store.subscribe([], vi.fn());
    vi.advanceTimersByTime(1000);
    expect(get).toHaveBeenCalledTimes(2);

    unsubscribe();
    visibility.mockRestore();
  });

  it('revalidates with the arguments of the newest active subscriber', async () => {
    const key = uniqueKey('latest-args');
    const get = vi.fn(async (token: string) => token);
    const store = createSWRStore<string, [string]>({
      key: () => key,
      get,
      freshAge: 0,
      staleAge: 0,
      revalidateOnFocus: true,
    });
    await store.get(['first']).data;

    const unsubscribeFirst = store.subscribe(['first'], vi.fn());
    const unsubscribeSecond = store.subscribe(['second'], vi.fn());

    get.mockClear();
    window.dispatchEvent(new Event('focus'));
    expect(get).toHaveBeenLastCalledWith('second');

    unsubscribeSecond();
    await flush();
    get.mockClear();
    window.dispatchEvent(new Event('focus'));
    expect(get).toHaveBeenLastCalledWith('first');

    unsubscribeFirst();
  });
});
