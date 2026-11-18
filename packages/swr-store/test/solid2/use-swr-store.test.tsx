import { Errored, Loading, createRoot, createSignal, flush as flushSolid } from 'solid-js';
import type { JSX } from '@solidjs/web';
import { render } from '@solidjs/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSWRStore } from '../../src';
import { useSWRStore, useSWRStoreSuspenseless } from '../../src/solid2';
import { createDeferred, flush, uniqueKey } from '../utils';

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function mount(view: () => JSX.Element): HTMLElement {
  const container = document.createElement('div');
  document.body.append(container);
  const dispose = render(view, container);
  cleanups.push(() => {
    dispose();
    container.remove();
  });
  return container;
}

function createOwned<T>(fn: () => T): T {
  return createRoot((dispose) => {
    cleanups.push(dispose);
    return fn();
  });
}

async function settle(): Promise<void> {
  await flush();
  flushSolid();
}

describe('useSWRStoreSuspenseless', () => {
  it('returns the pending result, then the fetched data', async () => {
    const key = uniqueKey('solid2-fetch');
    const deferred = createDeferred<string>();
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => deferred.promise,
    });

    const result = createOwned(() => useSWRStoreSuspenseless(store, (): [] => []));
    expect(result().status).toBe('pending');

    deferred.resolve('value');
    await settle();
    expect(result()).toEqual({ status: 'success', data: 'value' });
  });

  it('follows mutations and argument changes', async () => {
    const prefix = uniqueKey('solid2-args');
    const store = createSWRStore<string, [string]>({
      key: (id) => `${prefix}-${id}`,
      get: async (id) => id,
    });
    store.mutate(['a'], 'a', { revalidate: false });
    store.mutate(['b'], 'b', { revalidate: false });

    const [id, setId] = createSignal('a');
    const result = createOwned(() => useSWRStoreSuspenseless(store, (): [string] => [id()]));
    await settle();
    expect(result()).toEqual({ status: 'success', data: 'a' });

    store.mutate(['a'], 'a2', { revalidate: false });
    flushSolid();
    expect(result()).toEqual({ status: 'success', data: 'a2' });

    setId('b');
    await settle();
    expect(result()).toEqual({ status: 'success', data: 'b' });

    // The previous key is no longer tracked.
    store.mutate(['a'], 'a3', { revalidate: false });
    flushSolid();
    expect(result()).toEqual({ status: 'success', data: 'b' });
  });

  it('does not show data for a key it stopped watching', async () => {
    const prefix = uniqueKey('solid2-switch');
    const store = createSWRStore<string, [string]>({
      key: (id) => `${prefix}-${id}`,
      get: async (id) => `${id} fetched`,
    });
    store.mutate(['k'], 'start', { revalidate: false });
    store.mutate(['other'], 'other data', { revalidate: false });

    const follower = createOwned(() => {
      const watcher = useSWRStoreSuspenseless(store, (): [string] => ['k']);
      return useSWRStoreSuspenseless(store, (): [string] => {
        const current = watcher();
        return [current.status === 'success' && current.data === 'go' ? 'other' : 'k'];
      });
    });
    await settle();

    store.mutate(['k'], 'go', { revalidate: false });
    await settle();
    expect(follower()).toEqual({ status: 'success', data: 'other data' });
  });

  it('applies initialData only to the first key', async () => {
    const prefix = uniqueKey('solid2-initial-key');
    const get = vi.fn(async (id: string) => `fetched-${id}`);
    const store = createSWRStore<string, [string]>({ key: (id) => `${prefix}-${id}`, get });

    const [id, setId] = createSignal('1');
    const result = createOwned(() =>
      useSWRStoreSuspenseless(store, (): [string] => [id()], {
        initialData: 'server-1',
        hydrate: true,
      }),
    );
    expect(result()).toEqual({ status: 'success', data: 'server-1' });

    setId('2');
    await settle();
    expect(get).toHaveBeenCalledWith('2');
    expect(result()).toEqual({ status: 'success', data: 'fetched-2' });
  });
});

describe('useSWRStore', () => {
  it('shows the Loading fallback, then the fetched data', async () => {
    const key = uniqueKey('solid2-loading');
    const deferred = createDeferred<string>();
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => deferred.promise,
    });

    function Data(): JSX.Element {
      const data = useSWRStore(store, (): [] => []);
      return <>{data()}</>;
    }
    const container = mount(() => (
      <Loading fallback="loading">
        <Data />
      </Loading>
    ));
    await settle();
    expect(container.textContent).toBe('loading');

    deferred.resolve('value');
    await settle();
    expect(container.textContent).toBe('value');
  });

  it('keeps the data on screen when the cache changes', async () => {
    const key = uniqueKey('solid2-no-fallback');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'value',
    });

    function Data(): JSX.Element {
      const data = useSWRStore(store, (): [] => []);
      return <>{data()}</>;
    }
    const container = mount(() => (
      <Loading fallback="FALLBACK">
        <Data />
      </Loading>
    ));
    await settle();
    expect(container.textContent).toBe('value');

    store.mutate([], 'next', { revalidate: false });
    flushSolid();
    expect(container.textContent).toBe('next');
  });

  it('shows mutated data while the first fetch is still running', async () => {
    const key = uniqueKey('solid2-mutate-pending');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () =>
        new Promise<string>(() => {
          // Never settles.
        }),
    });

    function Data(): JSX.Element {
      const data = useSWRStore(store, (): [] => []);
      return <>{data()}</>;
    }
    const container = mount(() => (
      <Loading fallback="loading">
        <Data />
      </Loading>
    ));
    await settle();
    expect(container.textContent).toBe('loading');

    store.mutate([], 'mutated', { revalidate: false });
    await settle();
    expect(container.textContent).toBe('mutated');
  });

  it('sends a failure to the Errored boundary', async () => {
    const key = uniqueKey('solid2-error');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'value',
    });
    store.setResult([], { status: 'failure', data: new Error('failed') }, { revalidate: false });

    function Data(): JSX.Element {
      const data = useSWRStore(store, (): [] => []);
      return <>{data()}</>;
    }
    const container = mount(() => (
      <Errored fallback={(error) => `error: ${String(error())}`}>
        <Loading fallback="loading">
          <Data />
        </Loading>
      </Errored>
    ));
    await settle();
    expect(container.textContent).toBe('error: Error: failed');

    // A write of data heals the boundary.
    store.mutate([], 'recovered', { revalidate: false });
    await settle();
    expect(container.textContent).toBe('recovered');
  });

  it('starts from the initial data without the fallback', async () => {
    const key = uniqueKey('solid2-initial');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () =>
        new Promise<string>(() => {
          // Never settles.
        }),
    });

    function Data(): JSX.Element {
      const data = useSWRStore(store, (): [] => [], { initialData: 'initial' });
      return <>{data()}</>;
    }
    const container = mount(() => (
      <Loading fallback="loading">
        <Data />
      </Loading>
    ));
    await settle();
    expect(container.textContent).toBe('initial');
  });

  it('follows argument changes', async () => {
    const prefix = uniqueKey('solid2-resource-args');
    const store = createSWRStore<string, [string]>({
      key: (id) => `${prefix}-${id}`,
      get: async (id) => `fetched-${id}`,
    });

    const [id, setId] = createSignal('a');
    function Data(): JSX.Element {
      const data = useSWRStore(store, (): [string] => [id()]);
      return <>{data()}</>;
    }
    const container = mount(() => (
      <Loading fallback="loading">
        <Data />
      </Loading>
    ));
    await settle();
    expect(container.textContent).toBe('fetched-a');

    setId('b');
    await settle();
    await settle();
    expect(container.textContent).toBe('fetched-b');
  });

  it('accepts a mutate from a component body', async () => {
    const key = uniqueKey('solid2-mutate-in-body');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'value',
    });
    store.mutate([], 'start', { revalidate: false });

    function Data(): JSX.Element {
      const data = useSWRStore(store, (): [] => []);
      return <>{data()}</>;
    }
    function Writer(): JSX.Element {
      store.mutate([], 'from body', { revalidate: false });
      return null;
    }
    const container = mount(() => (
      <Loading fallback="loading">
        <Data />
        <Writer />
      </Loading>
    ));
    await settle();
    expect(container.textContent).toBe('from body');
  });
});

describe('Solid 2 subscriptions', () => {
  it('keeps polling when arguments change but the key does not', async () => {
    vi.useFakeTimers();
    try {
      const key = uniqueKey('solid2-args-polling');
      const get = vi.fn(async (token: string) => token);
      const store = createSWRStore<string, [string]>({
        key: () => key,
        get,
        freshAge: 0,
        staleAge: 0,
        refreshInterval: 1000,
      });
      store.mutate(['x'], 'start', { revalidate: false });

      const [token, setToken] = createSignal('t0');
      createOwned(() => useSWRStoreSuspenseless(store, (): [string] => [token()]));
      await vi.advanceTimersByTimeAsync(0);
      get.mockClear();

      for (let i = 1; i <= 4; i += 1) {
        // oxlint-disable-next-line no-await-in-loop
        await vi.advanceTimersByTimeAsync(400);
        setToken(`t${i}`);
      }
      await vi.advanceTimersByTimeAsync(400);

      expect(get).toHaveBeenCalled();
      expect(get).toHaveBeenLastCalledWith('t4');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not resubscribe when a signal read by the key changes', async () => {
    const [version, setVersion] = createSignal(0);
    const keyCalls = vi.fn();
    const prefix = uniqueKey('solid2-tracked-key');
    const store = createSWRStore<string>({
      key: () => {
        keyCalls();
        version();
        return prefix;
      },
      get: async () => 'value',
    });

    createOwned(() => useSWRStoreSuspenseless(store, (): [] => []));
    await settle();
    const before = keyCalls.mock.calls.length;

    setVersion(1);
    await settle();
    expect(keyCalls.mock.calls.length).toBe(before);
  });

  it('unsubscribes when the owner is disposed', async () => {
    const key = uniqueKey('solid2-dispose');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'value',
    });
    store.mutate([], 'start', { revalidate: false });

    let dispose!: () => void;
    const result = createRoot((disposeRoot) => {
      dispose = disposeRoot;
      return useSWRStoreSuspenseless(store, (): [] => []);
    });
    await settle();
    dispose();

    store.mutate([], 'after', { revalidate: false });
    await settle();
    expect(result()).toEqual({ status: 'success', data: 'start' });
  });
});
