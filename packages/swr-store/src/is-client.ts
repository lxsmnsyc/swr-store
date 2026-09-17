declare const DedicatedWorkerGlobalScope: unknown;
declare const SharedWorkerGlobalScope: unknown;
declare const Deno: unknown;

// The cache is kept on the client and skipped on the server, where it would be
// shared by every request.
//
// A client is a page with a `window`, which includes React Native, or a
// dedicated or shared web worker. Server runtimes such as Node, Bun and edge
// workers have neither. Edge workers only use the service worker scope, so
// that one is not checked. Deno also has the worker scopes inside its own
// workers, and a `window` before Deno 2, which still run on a server.
const IS_CLIENT =
  typeof Deno === 'undefined' &&
  (typeof window !== 'undefined' ||
    typeof DedicatedWorkerGlobalScope !== 'undefined' ||
    typeof SharedWorkerGlobalScope !== 'undefined');

export default IS_CLIENT;

// Event listeners and polling need `window` events, and visibility checks
// need a `document`. React Native and web workers lack some of them.
export const HAS_WINDOW_EVENTS =
  typeof window !== 'undefined' && typeof window.addEventListener === 'function';

export const HAS_DOCUMENT = typeof document !== 'undefined';
