import { Loading } from 'solid-js';
import type { JSX } from '@solidjs/web';
import { renderToStream } from '@solidjs/web';
import { describe, expect, it, vi } from 'vitest';
import { createSWRStore } from '../../src';
import { useSWRStore, useSWRStoreSuspenseless } from '../../src/solid2';
import { uniqueKey } from '../utils';

describe('Solid 2 on the server', () => {
  it('waits for a single fetch', async () => {
    const key = uniqueKey('solid2-server');
    const get = vi.fn(async () => 'fetched');
    const store = createSWRStore<string>({ key: () => key, get });

    function Data(): JSX.Element {
      const data = useSWRStore(store, (): [] => []);
      return <p>{data()}</p>;
    }

    const html = await renderToStream(() => (
      <Loading fallback="loading">
        <Data />
      </Loading>
    ));

    expect(html).toContain('fetched');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('renders initialData without fetching', async () => {
    const key = uniqueKey('solid2-server-initial');
    const get = vi.fn(async () => 'fetched');
    const store = createSWRStore<string>({ key: () => key, get });

    function Data(): JSX.Element {
      const data = useSWRStore(store, (): [] => [], { initialData: 'initial' });
      return <p>{data()}</p>;
    }

    const html = await renderToStream(() => <Data />);

    expect(html).toContain('initial');
    expect(get).not.toHaveBeenCalled();
  });

  it('fetches when initialData is passed as undefined', async () => {
    const key = uniqueKey('solid2-server-undefined-initial');
    const get = vi.fn(async () => 'fetched');
    const store = createSWRStore<string>({ key: () => key, get });

    function Data(): JSX.Element {
      const data = useSWRStore(store, (): [] => [], { initialData: undefined });
      return <p>{data()}</p>;
    }

    const html = await renderToStream(() => (
      <Loading fallback="loading">
        <Data />
      </Loading>
    ));

    expect(html).toContain('fetched');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('renders the pending result of the suspenseless reader', async () => {
    const key = uniqueKey('solid2-server-suspenseless');
    const get = vi.fn(async () => 'fetched');
    const store = createSWRStore<string>({ key: () => key, get });

    function Data(): JSX.Element {
      const result = useSWRStoreSuspenseless(store, (): [] => []);
      return <p>{result().status}</p>;
    }

    const html = await renderToStream(() => <Data />);

    // Nothing waits on the pending result, so the server does not fetch.
    expect(html).toContain('pending');
    expect(get).not.toHaveBeenCalled();
  });
});
