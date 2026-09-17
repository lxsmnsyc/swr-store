import { dequal } from 'dequal/lite';
import type { SWRStoreExtendedOptions } from './types';

// Plain objects get their keys sorted, so `{ a, b }` and `{ b, a }` give the
// same key. Values JSON cannot tell apart or cannot write get a tagged form.
function keyReplacer(_key: string, value: unknown): unknown {
  if (value === undefined) {
    return { $undefined: true };
  }
  if (typeof value === 'bigint') {
    return { $bigint: value.toString() };
  }
  if (value instanceof Map) {
    return { $map: Array.from(value.entries()) };
  }
  if (value instanceof Set) {
    return { $set: Array.from(value.values()) };
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const entries = Object.entries(value);
    entries.sort(([a], [b]) => {
      if (a === b) {
        return 0;
      }
      return a < b ? -1 : 1;
    });
    return Object.fromEntries(entries);
  }
  return value;
}

export function serializeKey(args: unknown[]): string {
  return JSON.stringify(args, keyReplacer);
}

function defaultKey(...args: unknown[]): string {
  return serializeKey(args);
}

export default function getDefaultConfig<T, P extends any[]>(): SWRStoreExtendedOptions<T, P> {
  return {
    revalidateOnFocus: false,
    revalidateOnNetwork: false,
    revalidateOnVisibility: false,
    refreshWhenHidden: false,
    refreshWhenBlurred: false,
    refreshWhenOffline: false,
    freshAge: 2000,
    staleAge: 30000,
    key: defaultKey,
    compare: dequal,
    maxRetryInterval: 5000,
  };
}
