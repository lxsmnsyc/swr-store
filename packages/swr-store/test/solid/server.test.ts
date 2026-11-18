import { Suspense } from 'solid-js';
import { createComponent, renderToStringAsync } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';
import { createSWRStore } from '../../src';
import { useSWRStore } from '../../src/solid';
import { uniqueKey } from '../utils';

describe('Solid on the server', () => {
  it('waits for a single fetch', async () => {
    const key = uniqueKey('solid-server');
    const get = vi.fn(async () => 'fetched');
    const store = createSWRStore<string>({ key: () => key, get });

    function Data() {
      const data = useSWRStore(store, (): [] => []);
      return data();
    }

    const html = await renderToStringAsync(() =>
      createComponent(Suspense, {
        fallback: 'loading',
        get children() {
          return createComponent(Data, {});
        },
      }),
    );

    expect(html).toContain('fetched');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('renders initialData without fetching', async () => {
    const key = uniqueKey('solid-server-initial');
    const get = vi.fn(async () => 'fetched');
    const store = createSWRStore<string>({ key: () => key, get });

    function Data() {
      const data = useSWRStore(store, (): [] => [], { initialData: 'initial' });
      return data();
    }

    const html = await renderToStringAsync(() => createComponent(Data, {}));

    expect(html).toContain('initial');
    expect(get).not.toHaveBeenCalled();
  });
  it('fetches when initialData is passed as undefined', async () => {
    const key = uniqueKey('solid-server-undefined-initial');
    const get = vi.fn(async () => 'fetched');
    const store = createSWRStore<string>({ key: () => key, get });

    function Data() {
      const data = useSWRStore(store, (): [] => [], { initialData: undefined });
      return data();
    }

    const html = await renderToStringAsync(() =>
      createComponent(Suspense, {
        fallback: 'loading',
        get children() {
          return createComponent(Data, {});
        },
      }),
    );

    expect(html).toContain('fetched');
    expect(get).toHaveBeenCalledTimes(1);
  });
});
