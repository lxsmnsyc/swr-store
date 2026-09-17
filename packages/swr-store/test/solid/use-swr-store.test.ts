import type { Resource } from 'solid-js';
import { Suspense, createRoot, createSignal } from 'solid-js';
import { createComponent, hydrate, memo, render } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';
import { createSWRStore } from '../../src';
import { useSWRStore, useSWRStoreSuspenseless } from '../../src/solid';
import { createDeferred, flush, uniqueKey } from '../utils';

describe('useSWRStoreSuspenseless', () => {
  it('returns the pending result, then the fetched data', async () => {
    const key = uniqueKey('solid-fetch');
    const deferred = createDeferred<string>();
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => deferred.promise,
    });

    await createRoot(async (dispose) => {
      const result = useSWRStoreSuspenseless(store, (): [] => []);
      expect(result().status).toBe('pending');

      deferred.resolve('value');
      await flush();

      expect(result()).toEqual({ status: 'success', data: 'value' });
      dispose();
    });
  });

  it('follows mutations and argument changes', async () => {
    const prefix = uniqueKey('solid-args');
    const store = createSWRStore<string, [string]>({
      key: (id) => `${prefix}-${id}`,
      get: async (id) => id,
    });
    store.mutate(['a'], 'a', { revalidate: false });
    store.mutate(['b'], 'b', { revalidate: false });

    await createRoot(async (dispose) => {
      const [id, setId] = createSignal('a');
      const result = useSWRStoreSuspenseless(store, (): [string] => [id()]);
      await flush();
      expect(result()).toEqual({ status: 'success', data: 'a' });

      store.mutate(['a'], 'a2', { revalidate: false });
      expect(result()).toEqual({ status: 'success', data: 'a2' });

      setId('b');
      await flush();
      expect(result()).toEqual({ status: 'success', data: 'b' });

      // The previous key is no longer tracked.
      store.mutate(['a'], 'a3', { revalidate: false });
      expect(result()).toEqual({ status: 'success', data: 'b' });
      dispose();
    });
  });
});

describe('useSWRStore', () => {
  it('resolves the resource with the fetched data', async () => {
    const key = uniqueKey('solid-resource');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'value',
    });

    await createRoot(async (dispose) => {
      const resource = useSWRStore(store, (): [] => []);
      expect(resource.loading).toBe(true);

      await flush();
      expect(resource()).toBe('value');
      dispose();
    });
  });

  it('starts from the initial data', () => {
    const key = uniqueKey('solid-initial');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'value',
    });

    createRoot((dispose) => {
      const resource = useSWRStore(store, (): [] => [], {
        initialData: 'initial',
      });
      expect(resource()).toBe('initial');
      dispose();
    });
  });

  it('rejects the resource on a failed fetch', async () => {
    const key = uniqueKey('solid-error');
    const error = new Error('failed');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'value',
    });
    store.setResult([], { status: 'failure', data: error }, { revalidate: false });

    await createRoot(async (dispose) => {
      const resource = useSWRStore(store, (): [] => []);
      await flush();
      expect(resource.error).toBe(error);
      dispose();
    });
  });
});

describe('Solid Suspense', () => {
  it('does not show the fallback again when the cache changes', async () => {
    const key = uniqueKey('solid-no-fallback');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'value',
    });
    const container = document.createElement('div');

    let resource!: Resource<string | undefined>;
    const dispose = render(
      () =>
        createComponent(Suspense, {
          fallback: 'FALLBACK',
          get children() {
            resource = useSWRStore(store, (): [] => []);
            const text = memo(() => resource() ?? '', true);
            return text();
          },
        }),
      container,
    );

    await flush();
    expect(container.textContent).toBe('value');

    store.mutate([], 'next', { revalidate: false });
    expect(resource.loading).toBe(false);
    expect(container.textContent).toBe('next');
    dispose();
  });
});

describe('Solid suspense recovery', () => {
  it('shows mutated data while the first fetch is still running', async () => {
    const key = uniqueKey('solid-mutate-suspended');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () =>
        new Promise<string>(() => {
          // Never settles.
        }),
    });
    const container = document.createElement('div');

    const dispose = render(
      () =>
        createComponent(Suspense, {
          fallback: 'loading',
          get children() {
            const resource = useSWRStore(store, (): [] => []);
            const text = memo(() => resource() ?? '', true);
            return text();
          },
        }),
      container,
    );
    expect(container.textContent).toBe('loading');

    store.mutate([], 'mutated', { revalidate: false });
    await flush();

    expect(container.textContent).toBe('mutated');
    dispose();
  });

  it('does not show data for a key it stopped watching', async () => {
    const prefix = uniqueKey('solid-switch');
    const store = createSWRStore<string, [string]>({
      key: (id) => `${prefix}-${id}`,
      get: async (id) => `${id} fetched`,
    });
    store.mutate(['k'], 'start', { revalidate: false });
    store.mutate(['other'], 'other data', { revalidate: false });

    await createRoot(async (dispose) => {
      const watcher = useSWRStoreSuspenseless(store, (): [string] => ['k']);
      const follower = useSWRStoreSuspenseless(store, (): [string] => {
        const current = watcher();
        return [current.status === 'success' && current.data === 'go' ? 'other' : 'k'];
      });
      await flush();

      store.mutate(['k'], 'go', { revalidate: false });
      await flush();

      expect(follower()).toEqual({ status: 'success', data: 'other data' });
      dispose();
    });
  });
});

describe('Solid hydration', () => {
  it('uses the data from server rendering instead of fetching again', async () => {
    const key = uniqueKey('solid-hydrate');
    const get = vi.fn(async () => 'client');
    const store = createSWRStore<string>({ key: () => key, get });

    // Stand-in for the data Solid's server rendering writes into the page.
    // Every resource reads 'server'.
    const resources = new Proxy<Record<string, unknown>>(
      {},
      {
        has: () => true,
        get: (_target, name) => (typeof name === 'string' ? 'server' : undefined),
      },
    );
    vi.stubGlobal('_$HY', { r: resources, events: [], completed: new WeakSet() });

    const container = document.createElement('div');
    container.textContent = 'server';
    document.body.append(container);

    const dispose = hydrate(() => {
      const resource = useSWRStore(store, (): [] => []);
      const text = memo(() => resource() ?? '', true);
      return text();
    }, container);
    await flush();

    expect(container.textContent).toBe('server');
    expect(get).not.toHaveBeenCalled();
    expect(store.get([], { revalidate: false })).toEqual({
      status: 'success',
      data: 'server',
    });

    dispose();
    container.remove();
    vi.unstubAllGlobals();
  });
});

describe('Solid hydration details', () => {
  function stubServerData(value: () => unknown): void {
    const resources = new Proxy<Record<string, unknown>>(
      {},
      {
        has: () => true,
        get: (_target, name) => (typeof name === 'string' ? value() : undefined),
      },
    );
    vi.stubGlobal('_$HY', { r: resources, events: [], completed: new WeakSet() });
  }

  it('keeps initial data a placeholder when hydrating without hydrate', async () => {
    const key = uniqueKey('solid-hydrate-initial');
    const get = vi.fn(async () => 'client');
    const store = createSWRStore<string>({ key: () => key, get });
    stubServerData(() => 'initial');

    const container = document.createElement('div');
    container.textContent = 'initial';
    const dispose = hydrate(() => {
      useSWRStore(store, (): [] => [], { initialData: 'initial' });
      return 'initial';
    }, container);
    await flush();

    expect(get).toHaveBeenCalledTimes(1);
    expect(store.get([], { revalidate: false })).toEqual({
      status: 'success',
      data: 'client',
    });
    dispose();
    vi.unstubAllGlobals();
  });

  it('uses server data when another reader already started a fetch', async () => {
    const key = uniqueKey('solid-hydrate-beside-suspenseless');
    const deferred = createDeferred<string>();
    const get = vi.fn(async () => deferred.promise);
    const store = createSWRStore<string>({ key: () => key, get });
    stubServerData(() => 'server');

    const container = document.createElement('div');
    let resource!: Resource<string | undefined>;
    const dispose = hydrate(() => {
      useSWRStoreSuspenseless(store, (): [] => []);
      resource = useSWRStore(store, (): [] => []);
      return '';
    }, container);
    await flush();
    deferred.resolve('client');
    await flush();

    expect(resource()).toBe('server');
    expect(store.get([], { revalidate: false })).toEqual({
      status: 'success',
      data: 'server',
    });
    dispose();
    vi.unstubAllGlobals();
  });

  it('fetches on the client when the server failed', async () => {
    const key = uniqueKey('solid-hydrate-failed');
    const get = vi.fn(async () => 'client');
    const store = createSWRStore<string>({ key: () => key, get });
    // oxlint-disable-next-line typescript/promise-function-async
    stubServerData(() => {
      const failed = Promise.reject(new Error('server failed'));
      failed.catch(() => undefined);
      return failed;
    });

    const container = document.createElement('div');
    let resource!: Resource<string | undefined>;
    const dispose = hydrate(() => {
      resource = useSWRStore(store, (): [] => []);
      return '';
    }, container);
    await flush();
    await flush();

    expect(get).toHaveBeenCalledTimes(1);
    expect(resource.state).toBe('ready');
    expect(resource()).toBe('client');
    dispose();
    vi.unstubAllGlobals();
  });
});

describe('Solid subscriptions', () => {
  it('keeps polling when arguments change but the key does not', async () => {
    vi.useFakeTimers();
    try {
      const key = uniqueKey('solid-args-polling');
      const get = vi.fn(async (token: string) => token);
      const store = createSWRStore<string, [string]>({
        key: () => key,
        get,
        freshAge: 0,
        staleAge: 0,
        refreshInterval: 1000,
      });
      store.mutate(['x'], 'start', { revalidate: false });

      await createRoot(async (dispose) => {
        const [token, setToken] = createSignal('t0');
        useSWRStoreSuspenseless(store, (): [string] => [token()]);
        get.mockClear();

        for (let i = 1; i <= 4; i += 1) {
          // oxlint-disable-next-line no-await-in-loop
          await vi.advanceTimersByTimeAsync(400);
          setToken(`t${i}`);
        }
        await vi.advanceTimersByTimeAsync(400);

        expect(get).toHaveBeenCalled();
        expect(get).toHaveBeenLastCalledWith('t4');
        dispose();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not resubscribe when a signal read by the key changes', async () => {
    const [version, setVersion] = createSignal(0);
    const keyCalls = vi.fn();
    const prefix = uniqueKey('solid-tracked-key');
    const store = createSWRStore<string>({
      key: () => {
        keyCalls();
        version();
        return prefix;
      },
      get: async () => 'value',
    });

    await createRoot(async (dispose) => {
      useSWRStoreSuspenseless(store, (): [] => []);
      await flush();
      const before = keyCalls.mock.calls.length;

      setVersion(1);
      await flush();

      expect(keyCalls.mock.calls.length).toBe(before);
      dispose();
    });
  });
});
