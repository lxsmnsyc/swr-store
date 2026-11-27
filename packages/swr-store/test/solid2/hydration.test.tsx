import solid from '@solidjs/vite-plugin';
import { hydrate } from '@solidjs/web';
import { type ViteDevServer, createServer, createServerModuleRunner } from 'vite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { UseSWRStoreOptions } from '../../src/solid2';
import { flush, uniqueKey } from '../utils';
import { createTestApp } from './fixtures/app';
import type * as ServerFixture from './fixtures/server';
import type { ServerRender } from './fixtures/server';

// The server half runs in a Vite module runner with the server builds of
// Solid and its own copy of swr-store, the way a server renders the page.
let server: ViteDevServer;
let runner: ReturnType<typeof createServerModuleRunner>;
let render: typeof ServerFixture.renderTestApp;

beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    plugins: [solid({ ssr: true })],
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    logLevel: 'error',
  });
  runner = createServerModuleRunner(server.environments.ssr, { hmr: false });

  // swr-store tells the server from the client by `window` when it loads.
  vi.stubGlobal('window', undefined);
  try {
    const mod: typeof ServerFixture = await runner.import('/test/solid2/fixtures/server.tsx');
    render = mod.renderTestApp;
  } finally {
    vi.unstubAllGlobals();
  }
});

afterAll(async () => {
  await runner.close();
  await server.close();
});

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, '_$HY');
  Reflect.deleteProperty(globalThis, '$R');
});

function runScripts(source: string): void {
  // oxlint-disable-next-line no-eval
  (0, eval)(source);
}

// Puts the server's HTML in the page, runs its scripts and hydrates it with
// a client copy of the app.
function hydrateOnClient(
  page: ServerRender,
  key: string,
  get: () => Promise<string>,
  options: UseSWRStoreOptions<string> = {},
): { container: HTMLElement; store: ReturnType<typeof createTestApp>['store'] } {
  const container = document.createElement('div');
  container.innerHTML = page.html;
  document.body.append(container);

  const scripts = [page.hydrationScript, page.html];
  for (const source of scripts) {
    const holder = document.createElement('div');
    holder.innerHTML = source;
    for (const script of holder.querySelectorAll('script')) {
      runScripts(script.textContent);
    }
  }
  for (const script of container.querySelectorAll('script')) {
    script.remove();
  }

  const { store, App } = createTestApp(key, get, options);
  const dispose = hydrate(() => <App />, container);
  cleanups.push(() => {
    dispose();
    container.remove();
  });
  return { container, store };
}

describe('Solid 2 hydration', () => {
  it('uses the data from server rendering instead of fetching again', async () => {
    const key = uniqueKey('solid2-hydrate');
    const page = await render(key, async () => 'server');
    expect(page.html).toContain('server');

    const get = vi.fn(async () => 'client');
    const { container, store } = hydrateOnClient(page, key, get);
    await flush();
    await flush();

    expect(container.textContent).toBe('server');
    expect(get).not.toHaveBeenCalled();
    expect(store.get([], { revalidate: false })).toEqual({
      status: 'success',
      data: 'server',
    });

    // The hydrated page follows the cache.
    store.mutate([], 'mutated', { revalidate: false });
    await flush();
    expect(container.textContent).toBe('mutated');
  });

  it('fetches on the client when the server failed', async () => {
    const key = uniqueKey('solid2-hydrate-failed');
    const page = await render(key, async () => {
      throw new Error('server failed');
    });
    expect(page.html).toContain('error');

    const get = vi.fn(async () => 'client');
    const { container } = hydrateOnClient(page, key, get);
    await flush();
    await flush();

    expect(get).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe('client');
  });

  it('keeps initial data a placeholder without hydrate', async () => {
    const key = uniqueKey('solid2-hydrate-initial');
    const options = { initialData: 'initial' };
    const page = await render(key, async () => 'server', options);
    expect(page.html).toContain('initial');

    const get = vi.fn(async () => 'client');
    const { container, store } = hydrateOnClient(page, key, get, options);
    await flush();
    await flush();

    expect(get).toHaveBeenCalledTimes(1);
    expect(store.get([], { revalidate: false })).toEqual({
      status: 'success',
      data: 'client',
    });
    expect(container.textContent).toBe('client');
  });

  it('writes initial data to the cache with hydrate', async () => {
    const key = uniqueKey('solid2-hydrate-initial-write');
    const options = { initialData: 'initial', hydrate: true };
    const page = await render(key, async () => 'server', options);

    const get = vi.fn(async () => 'client');
    const { container, store } = hydrateOnClient(page, key, get, options);
    await flush();
    await flush();

    expect(get).not.toHaveBeenCalled();
    expect(store.get([], { revalidate: false })).toEqual({
      status: 'success',
      data: 'initial',
    });
    expect(container.textContent).toBe('initial');
  });
});
