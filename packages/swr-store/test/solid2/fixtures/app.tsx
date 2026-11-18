import { Errored, Loading } from 'solid-js';
import type { JSX } from '@solidjs/web';
import { createSWRStore } from '../../../src';
import type { SWRStore } from '../../../src';
import { type UseSWRStoreOptions, useSWRStore } from '../../../src/solid2';

export interface TestApp {
  store: SWRStore<string>;
  App: () => JSX.Element;
}

// The same app renders on the server and hydrates on the client. Each side
// creates its own store, since the two sides do not share a module graph.
export function createTestApp(
  key: string,
  get: () => Promise<string>,
  options: UseSWRStoreOptions<string> = {},
): TestApp {
  const store = createSWRStore<string>({ key: () => key, get });

  function Data(): JSX.Element {
    const data = useSWRStore(store, (): [] => [], options);
    return <p>{data()}</p>;
  }

  function App(): JSX.Element {
    return (
      <Errored fallback="error">
        <Loading fallback="loading">
          <Data />
        </Loading>
      </Errored>
    );
  }

  return { store, App };
}
