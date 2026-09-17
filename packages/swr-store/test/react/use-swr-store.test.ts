import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { Suspense, createElement, useState } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { createSWRStore } from '../../src';
import { SWRStoreRoot, useSWRStore } from '../../src/react';
import { createDeferred, uniqueKey } from '../utils';

describe('useSWRStore', () => {
  it('returns the pending result, then the fetched data', async () => {
    const key = uniqueKey('react-fetch');
    const deferred = createDeferred<string>();
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => deferred.promise,
    });

    const { result } = renderHook(() => useSWRStore(store, []));
    expect(result.current.status).toBe('pending');

    act(() => {
      deferred.resolve('value');
    });

    await waitFor(() => {
      expect(result.current).toEqual({ status: 'success', data: 'value' });
    });
  });

  it('shows the initial data, then the fetched data', async () => {
    const key = uniqueKey('react-initial');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'fetched',
    });

    const { result } = renderHook(() => useSWRStore(store, [], { initialData: 'initial' }));
    expect(result.current).toEqual({ status: 'success', data: 'initial' });

    await waitFor(() => {
      expect(result.current).toEqual({ status: 'success', data: 'fetched' });
    });
  });

  it('renders the latest mutation', () => {
    const key = uniqueKey('react-mutate');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'fetched',
      initialData: 'initial',
    });
    store.mutate([], { status: 'success', data: 'first' }, false);

    const { result } = renderHook(() => useSWRStore(store, []));
    expect(result.current).toEqual({ status: 'success', data: 'first' });

    act(() => {
      store.mutate([], { status: 'success', data: 'second' }, false);
    });
    expect(result.current).toEqual({ status: 'success', data: 'second' });
  });

  it('reads again when the arguments change', () => {
    const prefix = uniqueKey('react-args');
    const store = createSWRStore<string, [string]>({
      key: (id) => `${prefix}-${id}`,
      get: async (id) => id,
    });
    store.mutate(['a'], { status: 'success', data: 'a' }, false);
    store.mutate(['b'], { status: 'success', data: 'b' }, false);

    const { result, rerender } = renderHook(({ id }: { id: string }) => useSWRStore(store, [id]), {
      initialProps: { id: 'a' },
    });
    expect(result.current).toEqual({ status: 'success', data: 'a' });

    rerender({ id: 'b' });
    expect(result.current).toEqual({ status: 'success', data: 'b' });
  });

  it('keeps one read across renders with equal arguments', () => {
    const key = uniqueKey('react-stable');
    const get = vi.fn(async (_id: string) => 'value');
    const store = createSWRStore<string, [string]>({
      key: () => key,
      get,
      freshAge: 0,
      staleAge: 0,
    });

    const { rerender } = renderHook(() => useSWRStore(store, ['a']));
    rerender();
    rerender();

    expect(get).toHaveBeenCalledTimes(1);
  });

  it('suspends until the data resolves', async () => {
    const key = uniqueKey('react-suspense');
    const deferred = createDeferred<string>();
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => deferred.promise,
    });

    function Data(): string {
      return useSWRStore(store, [], { suspense: true });
    }

    render(createElement(Suspense, { fallback: 'loading' }, createElement(Data)));
    expect(screen.getByText('loading')).toBeDefined();

    await act(async () => {
      deferred.resolve('ready');
      await deferred.promise;
    });

    await waitFor(() => {
      expect(screen.getByText('ready')).toBeDefined();
    });
  });

  it('throws the error of a failed fetch in suspense mode', () => {
    const key = uniqueKey('react-error');
    const error = new Error('failed');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'value',
    });
    store.mutate([], { status: 'failure', data: error }, false);

    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useSWRStore(store, [], { suspense: true }))).toThrow(error);
    vi.restoreAllMocks();
  });
});

describe('rendering', () => {
  it('does not update other components while a component renders', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const key = uniqueKey('react-render-update');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'value',
      freshAge: 10,
      staleAge: 10,
    });
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((message) => {
      errors.push(message);
    });

    function Status() {
      return useSWRStore(store, []).status;
    }

    let showSecond: (show: boolean) => void = () => undefined;
    function App() {
      const [show, setShow] = useState(false);
      showSecond = setShow;
      return createElement('div', null, createElement(Status), show ? createElement(Status) : null);
    }

    render(createElement(App));
    await waitFor(() => {
      expect(store.get([], { shouldRevalidate: false }).status).toBe('success');
    });

    // The entry has expired, so the second component starts a fetch while
    // it renders.
    vi.setSystemTime(Date.now() + 1000);
    await act(async () => {
      showSecond(true);
      await Promise.resolve();
    });

    expect(errors.filter((message) => String(message).includes('while rendering'))).toEqual([]);
    spy.mockRestore();
    vi.useRealTimers();
  });

  it('resolves suspense when every result expires right away', async () => {
    const key = uniqueKey('react-zero-age');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'ready',
      freshAge: 0,
      staleAge: 0,
    });

    function Data(): string {
      return useSWRStore(store, [], { suspense: true });
    }

    render(createElement(Suspense, { fallback: 'loading' }, createElement(Data)));

    // React may render the component more than once before it commits, and
    // with no fresh time each of those reads fetches. What matters is that
    // the retries end.
    await waitFor(() => {
      expect(screen.getByText('ready')).toBeDefined();
    });
  });

  it('hydrates with what the server rendered, then shows the cache', async () => {
    const key = uniqueKey('react-hydrate');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'value',
    });
    await store.get([]).data;

    function Status() {
      return createElement('p', null, useSWRStore(store, []).status);
    }

    // The server has no cache, so it rendered the pending state.
    const container = document.createElement('div');
    container.innerHTML = '<p>pending</p>';
    document.body.append(container);

    const recoverableErrors: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, createElement(Status), {
        onRecoverableError: (error) => {
          recoverableErrors.push(error);
        },
      });
      await Promise.resolve();
    });

    expect(recoverableErrors).toEqual([]);
    expect(container.innerHTML).toBe('<p>success</p>');
    container.remove();
  });
});

describe('SWRStoreRoot', () => {
  it('renders its children', () => {
    render(createElement(SWRStoreRoot, null, 'child'));
    expect(screen.getByText('child')).toBeDefined();
  });
});
