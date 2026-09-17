import { Suspense, createElement, startTransition } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSWRStore, subscribe } from '../../src';
import { useSWRStore } from '../../src/react';
import { createDeferred, uniqueKey } from '../utils';

// These tests render outside `act`, so React replays suspended renders the
// way it does in a browser.
beforeEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', false);
});

afterEach(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

async function waitUntil(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20 && !check(); attempt += 1) {
    // oxlint-disable-next-line no-await-in-loop
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }
}

describe('useSWRStore outside act', () => {
  it('shows a write that lands before a suspended transition replays', async () => {
    const key = uniqueKey('react-transition-replay');
    const deferred = createDeferred<string>();
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => {
        // The fetch starts in the first render attempt. The listener below
        // subscribes after the waiter does, so the waiter sees 'first'.
        queueMicrotask(() => {
          const unsubscribe = subscribe<string>(key, (mutation) => {
            if (mutation.result.status === 'success' && mutation.result.data === 'first') {
              unsubscribe();
              store.mutate([], 'second', { revalidate: false });
            }
          });
          deferred.resolve('first');
        });
        return deferred.promise;
      },
    });

    function Data(): string {
      return useSWRStore(store, [], { suspense: true });
    }

    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    startTransition(() => {
      root.render(createElement(Suspense, { fallback: 'loading' }, createElement(Data)));
    });

    await waitUntil(() => container.textContent === 'second');
    expect(container.textContent).toBe('second');
    root.unmount();
    container.remove();
  });

  it('does not fetch outside the cache when hydrating suspended content', async () => {
    const key = uniqueKey('react-hydrate-suspense');
    const get = vi.fn(async () => 'value');
    const store = createSWRStore<string>({ key: () => key, get });

    function Data(): string {
      return useSWRStore(store, [], { suspense: true });
    }

    // Server HTML from a setup that rendered the data without `initialData`.
    const container = document.createElement('div');
    container.innerHTML = '<!--$-->value<!--/$-->';
    document.body.append(container);

    const root = hydrateRoot(
      container,
      createElement(Suspense, { fallback: 'loading' }, createElement(Data)),
      { onRecoverableError: () => undefined },
    );

    // The server HTML already shows the value, so wait for the fetch and
    // give React time to retry the boundary.
    await waitUntil(() => get.mock.calls.length > 0);
    await waitUntil(() => false);
    expect(container.textContent).toBe('value');
    expect(get).toHaveBeenCalledTimes(1);
    root.unmount();
    container.remove();
  });
});
