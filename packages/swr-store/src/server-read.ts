import type { SWRGet, SWRStore } from './types';

const SERVER_READS = new WeakMap<object, SWRGet<any, any>>();

// Stores what a read returns on the server. During hydration, the bindings
// render this instead of the client cache, so the first client render matches
// the HTML from the server.
export function setServerRead<T, P extends any[]>(store: SWRStore<T, P>, read: SWRGet<T, P>): void {
  SERVER_READS.set(store, read);
}

export function getServerRead<T, P extends any[]>(store: SWRStore<T, P>): SWRGet<T, P> | undefined {
  return SERVER_READS.get(store);
}
