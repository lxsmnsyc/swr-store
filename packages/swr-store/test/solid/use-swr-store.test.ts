import type { Resource } from 'solid-js';
import { Suspense, createRoot, createSignal } from 'solid-js';
import { createComponent, memo, render } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
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
    store.mutate(['a'], { status: 'success', data: 'a' }, false);
    store.mutate(['b'], { status: 'success', data: 'b' }, false);

    await createRoot(async (dispose) => {
      const [id, setId] = createSignal('a');
      const result = useSWRStoreSuspenseless(store, (): [string] => [id()]);
      await flush();
      expect(result()).toEqual({ status: 'success', data: 'a' });

      store.mutate(['a'], { status: 'success', data: 'a2' }, false);
      expect(result()).toEqual({ status: 'success', data: 'a2' });

      setId('b');
      await flush();
      expect(result()).toEqual({ status: 'success', data: 'b' });

      // The previous key is no longer tracked.
      store.mutate(['a'], { status: 'success', data: 'a3' }, false);
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
    store.mutate([], { status: 'failure', data: error }, false);

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

    store.mutate([], { status: 'success', data: 'next' }, false);
    expect(resource.loading).toBe(false);
    expect(container.textContent).toBe('next');
    dispose();
  });
});
