import { h } from 'preact';
import { Suspense } from 'preact/compat';
import { renderToStringAsync } from 'preact-render-to-string';
import { describe, expect, it, vi } from 'vitest';
import { createSWRStore } from '../../src';
import { useSWRStore } from '../../src/preact';
import { uniqueKey } from '../utils';

describe('Preact on the server', () => {
  it('renders initialData without fetching', async () => {
    const key = uniqueKey('preact-server-initial');
    const get = vi.fn(async () => 'fetched');
    const store = createSWRStore<string>({ key: () => key, get });

    function Data() {
      return h('p', null, useSWRStore(store, [], { suspense: true, initialData: 'initial' }));
    }

    await expect(renderToStringAsync(h(Data, null))).resolves.toBe('<p>initial</p>');
    expect(get).not.toHaveBeenCalled();
  });

  it('renders the pending state without suspense', async () => {
    const key = uniqueKey('preact-server-pending');
    const get = vi.fn(async () => 'fetched');
    const store = createSWRStore<string>({ key: () => key, get });

    function Status() {
      return h('p', null, useSWRStore(store, []).status);
    }

    await expect(renderToStringAsync(h(Status, null))).resolves.toBe('<p>pending</p>');
    expect(get).not.toHaveBeenCalled();
  });

  it('fails a suspending read instead of refetching forever', async () => {
    const key = uniqueKey('preact-server-suspense');
    const get = vi.fn(async () => 'fetched');
    const store = createSWRStore<string>({ key: () => key, get });

    function Data() {
      return h('p', null, useSWRStore(store, [], { suspense: true }));
    }

    await expect(
      renderToStringAsync(h(Suspense, { fallback: 'loading' }, h(Data, null))),
    ).rejects.toThrow('cannot suspend on the server');
    expect(get).not.toHaveBeenCalled();
  });
});
