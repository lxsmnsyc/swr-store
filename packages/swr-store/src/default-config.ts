import { dequal } from 'dequal/lite';
import type { SWRStoreExtendedOptions } from './types';

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Plain objects get their keys sorted, so `{ a, b }` and `{ b, a }` give the
// same key. Values JSON cannot tell apart or cannot write get a tagged form,
// such as `{ "$undefined": true }`. Object keys that start with `$` get an
// extra `$`, so a plain object never looks like a tag.
function keyReplacer(this: unknown, key: string, value: unknown): unknown {
  // `toJSON` has already run on `value`, so a `Date` is read from its holder.
  const raw: unknown = key === '' ? value : Reflect.get(Object(this), key);
  if (raw instanceof Date) {
    return { $date: Number.isNaN(raw.getTime()) ? null : raw.toISOString() };
  }
  if (value === undefined) {
    return { $undefined: true };
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return { $number: String(value) };
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
  if (value !== null && typeof value === 'object' && isPlainObject(value)) {
    const entries = Object.entries(value).map(([name, item]): [string, unknown] => [
      name.startsWith('$') ? `$${name}` : name,
      item,
    ]);
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
