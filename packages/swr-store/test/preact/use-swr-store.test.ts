import { act, render, renderHook, screen, waitFor } from '@testing-library/preact';
import { h } from 'preact';
import { Suspense } from 'preact/compat';
import { describe, expect, it, vi } from 'vitest';
import { createSWRStore } from '../../src';
import { SWRStoreRoot, useSWRStore } from '../../src/preact';
import { createDeferred, uniqueKey } from '../utils';

describe('useSWRStore', () => {
  it('returns the pending result, then the fetched data', async () => {
    const key = uniqueKey('preact-fetch');
    const deferred = createDeferred<string>();
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => deferred.promise,
    });

    const { result } = renderHook(() => useSWRStore(store, []));
    expect(result.current.status).toBe('pending');

    await act(() => {
      deferred.resolve('value');
    });

    await waitFor(() => {
      expect(result.current).toEqual({ status: 'success', data: 'value' });
    });
  });

  it('shows the initial data, then the fetched data', async () => {
    const key = uniqueKey('preact-initial');
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

  it('renders the latest mutation', async () => {
    const key = uniqueKey('preact-mutate');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'fetched',
      initialData: 'initial',
    });
    store.mutate([], { status: 'success', data: 'first' }, false);

    const { result } = renderHook(() => useSWRStore(store, []));
    expect(result.current).toEqual({ status: 'success', data: 'first' });

    await act(() => {
      store.mutate([], { status: 'success', data: 'second' }, false);
    });
    expect(result.current).toEqual({ status: 'success', data: 'second' });
  });

  it('reads again when the arguments change', () => {
    const prefix = uniqueKey('preact-args');
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
    const key = uniqueKey('preact-stable');
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
    const key = uniqueKey('preact-suspense');
    const deferred = createDeferred<string>();
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => deferred.promise,
    });

    function Data(): string {
      return useSWRStore(store, [], { suspense: true });
    }

    render(h(Suspense, { fallback: 'loading' }, h(Data, null)));
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
    const key = uniqueKey('preact-error');
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

describe('SWRStoreRoot', () => {
  it('renders its children', () => {
    render(h(SWRStoreRoot, null, 'child'));
    expect(screen.getByText('child')).toBeDefined();
  });
});
