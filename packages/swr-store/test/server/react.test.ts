import { Suspense, createElement } from 'react';
import { prerender } from 'react-dom/static';
import { describe, expect, it, vi } from 'vitest';
import { createSWRStore } from '../../src';
import { useSWRStore } from '../../src/react';
import { uniqueKey } from '../utils';

async function render(element: ReturnType<typeof createElement>) {
  const errors: unknown[] = [];
  const { prelude } = await prerender(element, {
    onError: (error) => {
      errors.push(error);
    },
  });
  return { errors, html: await new Response(prelude).text() };
}

describe('React on the server', () => {
  it('renders initialData without fetching', async () => {
    const key = uniqueKey('react-server-initial');
    const get = vi.fn(async () => 'fetched');
    const store = createSWRStore<string>({ key: () => key, get });

    function Data() {
      return useSWRStore(store, [], { suspense: true, initialData: 'initial' });
    }

    const { html } = await render(createElement(Data));
    expect(html).toBe('initial');
    expect(get).not.toHaveBeenCalled();
  });

  it('leaves a suspending read to the client instead of refetching forever', async () => {
    const key = uniqueKey('react-server-suspense');
    const get = vi.fn(async () => 'fetched');
    const store = createSWRStore<string>({ key: () => key, get });

    function Data() {
      return useSWRStore(store, [], { suspense: true });
    }

    const { errors, html } = await render(
      createElement(Suspense, { fallback: 'loading' }, createElement(Data)),
    );
    expect(html).toContain('loading');
    expect(errors).toHaveLength(1);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('renders the pending state without suspense', async () => {
    const key = uniqueKey('react-server-pending');
    const store = createSWRStore<string>({
      key: () => key,
      get: async () => 'fetched',
    });

    function Status() {
      return useSWRStore(store, []).status;
    }

    const { html } = await render(createElement(Status));
    expect(html).toBe('pending');
  });
});
