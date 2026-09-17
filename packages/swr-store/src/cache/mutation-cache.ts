import type { ReactiveCacheListener } from './reactive-cache';
import {
  createReactiveCache,
  getReactiveCacheListenerSize,
  getReactiveCacheValue,
  scheduleReactiveCacheNotify,
  setReactiveCacheValue,
  subscribeReactiveCache,
} from './reactive-cache';

export interface SWRPending<T> {
  data: Promise<T>;
  status: 'pending';
}
export interface SWRSuccess<T> {
  data: T;
  status: 'success';
}
export interface SWRFailure {
  data: any;
  status: 'failure';
}
export type SWRResult<T> = SWRPending<T> | SWRSuccess<T> | SWRFailure;

export interface SWREntry<T> {
  result: SWRResult<T>;
  timestamp: number;
  isValidating: boolean;
}

interface Pin {
  count: number;
  // The version of the latest write to the key while it is pinned.
  version: number;
}

// Keys with a running fetch. Their entries are never evicted, and their
// latest write version is kept here too, so a fetch can still tell that it
// is outdated when the entry is gone.
const pins = new Map<string, Pin>();

export const MUTATION_CACHE = createReactiveCache<SWREntry<any>>(undefined, (key) => pins.has(key));

export type SWRListener<T> = ReactiveCacheListener<SWREntry<T>>;

export function subscribeMutation<T>(key: string, listener: SWRListener<T>): () => void {
  return subscribeReactiveCache(MUTATION_CACHE, key, listener);
}

let lastVersion = 0;
const VERSIONS = new WeakMap<SWREntry<unknown>, number>();

// Every write gets a version that is higher than any version before it. A
// fetch compares versions to tell whether the entry was written after it
// started. Timestamps cannot do that, because two writes can share the same
// millisecond.
export function nextVersion(): number {
  lastVersion += 1;
  return lastVersion;
}

export function getVersion(mutation: SWREntry<unknown>): number {
  return VERSIONS.get(mutation) ?? 0;
}

function setVersion(key: string, value: SWREntry<unknown>): void {
  const version = nextVersion();
  VERSIONS.set(value, version);
  const pin = pins.get(key);
  if (pin) {
    pin.version = version;
  }
}

export function pinKey(key: string): void {
  const pin = pins.get(key);
  if (pin) {
    pin.count += 1;
  } else {
    pins.set(key, { count: 1, version: 0 });
  }
}

export function unpinKey(key: string): void {
  const pin = pins.get(key);
  if (pin) {
    pin.count -= 1;
    if (pin.count === 0) {
      pins.delete(key);
    }
  }
}

// The version of the latest write to `key`, including one whose entry was
// evicted while the key was pinned.
export function getLastWriteVersion(key: string): number {
  const entry = MUTATION_CACHE.cache.peek(key);
  return Math.max(pins.get(key)?.version ?? 0, entry ? getVersion(entry.value) : 0);
}

export function setMutation<T>(key: string, value: SWREntry<T>, notify = true): void {
  setVersion(key, value);
  setReactiveCacheValue(MUTATION_CACHE, key, value, notify);
}

// Writes now and notifies subscribers in a microtask. Reads can write to the
// cache while a UI library is rendering, and notifying right away would make
// other components update in the middle of that render.
export function setMutationDeferred<T>(key: string, value: SWREntry<T>): void {
  setVersion(key, value);
  setReactiveCacheValue(MUTATION_CACHE, key, value, false);
  scheduleReactiveCacheNotify(MUTATION_CACHE, key);
}

export function getMutation<T>(key: string): SWREntry<T> | undefined {
  return getReactiveCacheValue(MUTATION_CACHE, key);
}

export function getMutationListenerSize(key: string): number {
  return getReactiveCacheListenerSize(MUTATION_CACHE, key);
}
