import type { RenderResult } from '@testing-library/react';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { Component, StrictMode, Suspense, createElement, startTransition, useState } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { createSWRStore, setCacheSize } from '../../src';
import { SWRStoreRoot, useSWRStore } from '../../src/react';
import { createDeferred, uniqueKey } from '../utils';

// A render that suspends with `use` has to happen inside an awaited `act`,
// or React does not retry it once the data arrives.
async function renderSuspending(element: ReactElement): Promise<RenderResult> {
  let view: RenderResult | undefined;
  await act(async () => {
    view = render(element);
    await Promise.resolve();
  });
  if (!view) {
    throw new Error('render did not run');
  }
  return view;
}

// Like `waitFor`, but each wait runs inside `act`, so React retries renders
// that suspended with `use` while waiting.
async function waitInAct(check: () => void): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      check();
      return;
    } catch (error) {
      if (attempt >= 50) {
        throw error;
      }
    }
    // oxlint-disable-next-line no-await-in-loop
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
      });
    });
  }
}

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

    await renderSuspending(createElement(Suspense, { fallback: 'loading' }, createElement(Data)));
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

    const view = await renderSuspending(
      createElement(Suspense, { fallback: 'loading' }, createElement(Data)),
    );

    // React may render the component more than once before it commits, and
    // with no fresh time each of those reads fetches. What matters is that
    // the retries end.
    await waitInAct(() => {
      expect(view.container.textContent).toBe('ready');
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

describe('React stability', () => {
  it('does not loop when initialData is a new object every render', () => {
    const key = uniqueKey('react-initial-object');
    const store = createSWRStore<string[]>({
      key: () => key,
      get: async () => ['value'],
    });

    const { result, rerender } = renderHook(() => useSWRStore(store, [], { initialData: [] }));
    rerender();

    expect(result.current).toEqual({ status: 'success', data: [] });
  });

  it('does not loop when an argument is a new object every render', () => {
    const store = createSWRStore<string, [{ id: string }]>({
      name: uniqueKey('react-object-args'),
      get: async ({ id }) => id,
    });

    const { result, rerender } = renderHook(() => useSWRStore(store, [{ id: '1' }]));
    rerender();

    expect(result.current.status).toBe('pending');
  });

  it('accepts a suspense flag that is only known at runtime', async () => {
    const key = uniqueKey('react-dynamic-suspense');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'value',
    });
    await store.get([]).data;
    const suspense = Math.random() > 2;

    const { result } = renderHook(() => useSWRStore(store, [], { suspense }));

    expect(result.current).toEqual({ status: 'success', data: 'value' });
  });

  it('writes hydrated initial data to the cache', () => {
    const key = uniqueKey('react-hydrate');
    const get = vi.fn(async () => 'fetched');
    const store = createSWRStore<string>({ key: () => key, get });

    renderHook(() => useSWRStore(store, [], { initialData: 'server', hydrate: true }));

    expect(store.get([], { shouldRevalidate: false })).toEqual({
      status: 'success',
      data: 'server',
    });
    expect(get).not.toHaveBeenCalled();
  });

  it('revalidates after a suspended component unmounts before its fetch settles', async () => {
    const key = uniqueKey('react-unmount');
    const deferred = createDeferred<string>();
    const get = vi.fn(async () => deferred.promise);
    const store = createSWRStore<string>({
      key: () => key,
      get,
      freshAge: 10,
      staleAge: 10,
    });

    function Data() {
      return useSWRStore(store, [], { suspense: true });
    }

    const view = await renderSuspending(
      createElement(Suspense, { fallback: 'loading' }, createElement(Data)),
    );
    view.unmount();
    deferred.resolve('value');
    await deferred.promise;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });

    expect(store.get([]).status).toBe('pending');
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe('React StrictMode', () => {
  it('finishes suspense when every result expires right away', async () => {
    const key = uniqueKey('react-strict-zero-age');
    const get = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 5);
      });
      return 'ready';
    });
    const store = createSWRStore<string>({
      key: () => key,
      get,
      freshAge: 0,
      staleAge: 0,
    });

    function Data(): string {
      return useSWRStore(store, [], { suspense: true });
    }

    const view = await renderSuspending(
      createElement(
        StrictMode,
        null,
        createElement(Suspense, { fallback: 'loading' }, createElement(Data)),
      ),
    );

    await waitFor(() => {
      expect(view.container.textContent).toBe('ready');
    });
    // Updates outside `act` are not applied in tests, so the wait happens
    // inside it.
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100);
      });
    });

    // One fetch to show the data, and one revalidation after mounting.
    expect(view.container.textContent).toBe('ready');
    expect(get.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe('React suspense recovery', () => {
  it('finishes when every other cache entry has subscribers', async () => {
    setCacheSize(1);
    try {
      const prefix = uniqueKey('react-full-cache');
      const holder = createSWRStore<string>({
        key: () => `${prefix}-held`,
        get: async () => 'held',
      });
      await holder.get([]).data;
      const unsubscribe = holder.subscribe([], vi.fn());
      const get = vi.fn(async () => 'value');
      const store = createSWRStore<string>({ key: () => `${prefix}-read`, get });

      function Data(): string {
        return useSWRStore(store, [], { suspense: true });
      }

      const view = await renderSuspending(
        createElement(Suspense, { fallback: 'loading' }, createElement(Data)),
      );
      await waitFor(() => {
        expect(view.container.textContent).toBe('value');
      });
      expect(get).toHaveBeenCalledTimes(1);
      unsubscribe();
    } finally {
      setCacheSize(1000);
    }
  });

  it('shows mutated data while the first fetch is still running', async () => {
    const key = uniqueKey('react-mutate-suspended');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () =>
        new Promise<string>(() => {
          // Never settles.
        }),
    });

    function Data(): string {
      return useSWRStore(store, [], { suspense: true });
    }

    const view = await renderSuspending(
      createElement(Suspense, { fallback: 'loading' }, createElement(Data)),
    );
    expect(view.container.textContent).toBe('loading');

    await act(async () => {
      store.mutate([], { status: 'success', data: 'mutated' }, false);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20);
      });
    });

    await waitFor(() => {
      expect(view.container.textContent).toBe('mutated');
    });
  });

  it('fetches again when an error boundary resets', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const key = uniqueKey('react-error-reset');
    let calls = 0;
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error('failed');
        }
        return 'ok';
      },
      maxRetryCount: 0,
      freshAge: 1000,
      staleAge: 0,
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    let reset = (): void => undefined;
    class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
      state = { failed: false };

      static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
      }

      render(): ReactNode {
        reset = () => {
          this.setState({ failed: false });
        };
        return this.state.failed ? 'error' : this.props.children;
      }
    }

    function Data(): string {
      return useSWRStore(store, [], { suspense: true });
    }

    const view = await renderSuspending(
      createElement(
        Boundary,
        null,
        createElement(Suspense, { fallback: 'loading' }, createElement(Data)),
      ),
    );
    await waitFor(() => {
      expect(view.container.textContent).toBe('error');
    });

    // Within `freshAge`, the failure is still shown. Once it is no longer
    // fresh, resetting the boundary fetches again.
    vi.setSystemTime(Date.now() + 2000);
    await act(async () => {
      reset();
      await Promise.resolve();
    });
    await waitInAct(() => {
      expect(view.container.textContent).toBe('ok');
    });
    expect(calls).toBe(2);
    spy.mockRestore();
    vi.useRealTimers();
  });
});

describe('React use and arguments', () => {
  it('calls use again when a suspended transition finishes', async () => {
    const key = uniqueKey('react-transition-use');
    const store = createSWRStore<string>({ key: () => key, get: async () => 'value' });
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((message) => {
      errors.push(message);
    });

    function Data(): string {
      return useSWRStore(store, [], { suspense: true });
    }

    let show = (): void => undefined;
    function App() {
      const [visible, setVisible] = useState(false);
      show = () => {
        startTransition(() => {
          setVisible(true);
        });
      };
      return createElement(
        Suspense,
        { fallback: 'loading' },
        visible ? createElement(Data) : 'hidden',
      );
    }

    const view = await renderSuspending(createElement(App));
    await act(async () => {
      show();
      await Promise.resolve();
    });
    await waitInAct(() => {
      expect(view.container.textContent).toBe('value');
    });

    expect(errors.filter((message) => String(message).includes('use()'))).toEqual([]);
    spy.mockRestore();
  });

  it('revalidates with the newest arguments when the key stays the same', async () => {
    const key = uniqueKey('react-latest-args');
    const get = vi.fn(async (token: string) => token);
    const store = createSWRStore<string, [string]>({
      key: () => key,
      get,
      freshAge: 0,
      staleAge: 0,
      revalidateOnFocus: true,
    });

    const { rerender } = renderHook(({ token }: { token: string }) => useSWRStore(store, [token]), {
      initialProps: { token: 'first' },
    });
    await waitFor(() => {
      expect(store.get([''], { shouldRevalidate: false }).status).toBe('success');
    });

    rerender({ token: 'second' });
    get.mockClear();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(get).toHaveBeenLastCalledWith('second');
  });
});
