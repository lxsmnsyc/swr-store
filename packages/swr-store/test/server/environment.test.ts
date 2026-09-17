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
    name: 'environment',
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
    vi.stubGlobal('Deno', {});
    const { get, store } = await loadStore();

    await store.get([]).data;
    expect(store.get([]).status).toBe('pending');
    expect(get).toHaveBeenCalledTimes(1);
  });
});
