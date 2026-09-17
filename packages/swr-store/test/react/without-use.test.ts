import { act, render } from '@testing-library/react';
import * as React from 'react';
import { Suspense, createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createSWRStore } from '../../src';
import { useSWRStore } from '../../src/react';
import { createDeferred, uniqueKey } from '../utils';

// React 18 has no `use`. Removing it checks that the hook falls back to
// throwing the promise.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  use: undefined,
}));

describe('useSWRStore without use', () => {
  it('suspends by throwing the promise', async () => {
    expect(Reflect.get(React, 'use')).toBeUndefined();
    const key = uniqueKey('react-without-use');
    const deferred = createDeferred<string>();
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => deferred.promise,
    });

    function Data(): string {
      return useSWRStore(store, [], { suspense: true });
    }

    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(createElement(Suspense, { fallback: 'loading' }, createElement(Data)));
      await Promise.resolve();
    });
    expect(view.container.textContent).toBe('loading');

    await act(async () => {
      deferred.resolve('ready');
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 20);
      });
    });
    expect(view.container.textContent).toBe('ready');
  });
});
