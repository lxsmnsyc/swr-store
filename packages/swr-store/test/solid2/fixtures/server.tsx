import { generateHydrationScript, renderToStream } from '@solidjs/web';
import type { UseSWRStoreOptions } from '../../../src/solid2';
import { createTestApp } from './app';

export interface ServerRender {
  html: string;
  // The script that sets up hydration, which a page puts in its head.
  hydrationScript: string;
}

export async function renderTestApp(
  key: string,
  get: () => Promise<string>,
  options: UseSWRStoreOptions<string> = {},
): Promise<ServerRender> {
  const { App } = createTestApp(key, get, options);
  const html = await renderToStream(() => <App />);
  return { html, hydrationScript: generateHydrationScript() };
}
