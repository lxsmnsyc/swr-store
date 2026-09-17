import { dequal } from 'dequal/lite';
import type { SWRStoreExtendedOptions } from './types';

function compareNames(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function tag(name: string, value: string): string {
  return `{${JSON.stringify(name)}:${value}}`;
}

// Writes `value` like `JSON.stringify`, with changes that keep different
// arguments from sharing a key:
// - Object keys are sorted, so `{ a, b }` and `{ b, a }` give the same key.
// - Values JSON drops or merges get a tagged form, such as
//   `{"$undefined":true}`.
// - Object keys that start with `$` get an extra `$`, so an object never
//   looks like a tag.
// - Functions and symbols cannot be told apart, so they throw.
function encode(value: unknown, key: string, ancestors: Set<object>): string {
  let current: unknown = value;
  if (current !== null && typeof current === 'object' && !(current instanceof Date)) {
    const toJSON: unknown = Reflect.get(current, 'toJSON');
    if (typeof toJSON === 'function') {
      current = Reflect.apply(toJSON, current, [key]);
    }
  }

  if (current === undefined) {
    return tag('$undefined', 'true');
  }
  if (current === null || typeof current === 'string' || typeof current === 'boolean') {
    return JSON.stringify(current);
  }
  if (typeof current === 'number') {
    return Number.isFinite(current)
      ? JSON.stringify(current)
      : tag('$number', JSON.stringify(String(current)));
  }
  if (typeof current === 'bigint') {
    return tag('$bigint', JSON.stringify(current.toString()));
  }
  if (typeof current === 'function' || typeof current === 'symbol') {
    throw new TypeError(
      `A ${typeof current} cannot be part of a default cache key. Pass a custom \`key\` instead.`,
    );
  }
  const object: object = current;
  if (object instanceof Date) {
    return tag(
      '$date',
      Number.isNaN(object.getTime()) ? 'null' : JSON.stringify(object.toISOString()),
    );
  }
  if (ancestors.has(object)) {
    throw new TypeError('A circular value cannot be part of a default cache key.');
  }
  ancestors.add(object);
  try {
    if (Array.isArray(object)) {
      const items: string[] = [];
      for (let i = 0; i < object.length; i += 1) {
        items.push(encode(object[i], String(i), ancestors));
      }
      return `[${items.join(',')}]`;
    }
    if (object instanceof Map) {
      const entries: string[] = [];
      for (const [entryKey, entryValue] of object) {
        entries.push(`[${encode(entryKey, '0', ancestors)},${encode(entryValue, '1', ancestors)}]`);
      }
      return tag('$map', `[${entries.join(',')}]`);
    }
    if (object instanceof Set) {
      const items: string[] = [];
      for (const item of object) {
        items.push(encode(item, String(items.length), ancestors));
      }
      return tag('$set', `[${items.join(',')}]`);
    }
    const fields = Object.keys(object)
      .sort(compareNames)
      .map((name) => {
        const escaped = name.startsWith('$') ? `$${name}` : name;
        return `${JSON.stringify(escaped)}:${encode(Reflect.get(object, name), name, ancestors)}`;
      });
    return `{${fields.join(',')}}`;
  } finally {
    ancestors.delete(object);
  }
}

export function serializeKey(args: unknown[]): string {
  return encode(args, '', new Set());
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
