import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

// The environment is read once when the module loads, so each test stubs the
// globals first and then imports a fresh copy.
async function loadStore() {
  vi.resetModules();
  const { createSWRStore } = await import('../../src');
  const get = vi.fn(async () => 'value');
  const store = createSWRStore<string>({
    key: () => 'environment',
    get,
    revalidateOnFocus: true,
    revalidateOnVisibility: true,
    refreshInterval: 60_000,
    refreshWhenBlurred: true,
    refreshWhenHidden: true,
    refreshWhenOffline: true,
  });
  return { get, store };
}

describe('environment detection', () => {
  it('caches in React Native, which has a window without DOM events', async () => {
    vi.stubGlobal('window', {});
    const { get, store } = await loadStore();

    await store.get([]).data;
    expect(store.get([])).toEqual({ status: 'success', data: 'value' });
    expect(get).toHaveBeenCalledTimes(1);

    // Event options are skipped instead of throwing.
    const unsubscribe = store.subscribe([], vi.fn());
    unsubscribe();
  });

  it('caches in a dedicated web worker', async () => {
    vi.stubGlobal('DedicatedWorkerGlobalScope', {});
    const { get, store } = await loadStore();

    await store.get([]).data;
    expect(store.get([])).toEqual({ status: 'success', data: 'value' });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('does not cache in Deno, even with a window', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('Deno', { version: { deno: '2.0.0' } });
    const { get, store } = await loadStore();

    await store.get([]).data;
    expect(store.get([]).status).toBe('pending');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('caches on a page with an element whose id is Deno', async () => {
    // Browsers expose elements with an id as globals.
    vi.stubGlobal('window', {});
    vi.stubGlobal('Deno', {});
    const { get, store } = await loadStore();

    await store.get([]).data;
    expect(store.get([]).status).toBe('success');
    expect(get).toHaveBeenCalledTimes(1);
  });
  it('polls all the time when a chosen polling state cannot be detected', async () => {
    vi.stubGlobal('window', {});
    vi.useFakeTimers();
    try {
      vi.resetModules();
      const { createSWRStore } = await import('../../src');
      const get = vi.fn(async () => 'value');
      const store = createSWRStore<string>({
        key: () => 'polling-fallback',
        get,
        freshAge: 0,
        staleAge: 0,
        refreshInterval: 1000,
        refreshWhenBlurred: true,
      });
      await store.get([]).data;

      const unsubscribe = store.subscribe([], vi.fn());
      await vi.advanceTimersByTimeAsync(1000);
      expect(get).toHaveBeenCalledTimes(2);
      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });
});
