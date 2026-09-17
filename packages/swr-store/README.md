# swr-store

> Reactive stores for data fetching with the stale-while-revalidate strategy.

[![NPM](https://img.shields.io/npm/v/swr-store.svg)](https://www.npmjs.com/package/swr-store)

A store wraps an async function. Reading the store returns the cached result right away and refetches in the background when the cache gets old. Subscribers are notified when the cache changes.

The package has no framework dependency. Bindings for React, Preact and Solid ship as separate entry points.

## Install

```bash
npm install swr-store
```

```bash
pnpm add swr-store
```

The `swr-store/react`, `swr-store/preact` and `swr-store/solid` entry points need TypeScript's `moduleResolution` set to `bundler`, `node16` or `nodenext`.

## Quick start

```ts
import type { MutationResult } from 'swr-store';
import { createSWRStore } from 'swr-store';

interface User {
  id: string;
  name: string;
}

const userStore = createSWRStore<User, [string]>({
  key: (id) => `/user/${id}`,
  get: async (id) => {
    const response = await fetch(`/api/user/${id}`);
    if (!response.ok) {
      throw new Error('Failed to load user');
    }
    return (await response.json()) as User;
  },
  revalidateOnFocus: true,
});

const unsubscribe = userStore.subscribe(['123'], (mutation) => {
  render(mutation.result);
});

// Starts the fetch and returns a pending result.
render(userStore.get(['123']));

function render(result: MutationResult<User>) {
  if (result.status === 'pending') {
    showSpinner();
  } else if (result.status === 'failure') {
    showError(result.data);
  } else {
    showUser(result.data);
  }
}
```

## Results

Reading a store returns a `MutationResult<T>`. Check `status` to find out what `data` holds.

| `status`    | `data`                                                |
| ----------- | ----------------------------------------------------- |
| `'pending'` | A `Promise<T>` for the running fetch.                 |
| `'success'` | The fetched value, of type `T`.                       |
| `'failure'` | The error thrown by `get`, after the retries ran out. |

## Keys and the shared cache

In the browser, every store writes to one global cache. The `key` option turns the store arguments into a cache key.

- By default the key is the store `name` followed by `JSON.stringify(args)`. Without a `name`, the store's id is used instead, and two stores never share an entry through their default keys.
- Stores with a custom `key` share an entry when they produce the same key.
- The global `trigger`, `mutate` and `subscribe` functions take a key instead of arguments. Use `store.getKey(args)` to get it.
- The cache keeps up to 1000 entries. When it is full, the least recently used entry without subscribers is removed. Change the limit with [`setCacheSize`](#setcachesizesize).

The store id comes from a counter, so it changes every time the store is created. Create stores once at module level. When a store has to be created inside a function or component, set `name` so every instance uses the same entries.

```ts
function createUserStore() {
  return createSWRStore<User, [string]>({
    name: 'user',
    get: (id) => getUser(id),
  });
}
```

The server has no cache. See [Server rendering](#server-rendering).

A custom key lets you leave arguments out of the key, such as an auth token.

```ts
const privateData = createSWRStore<Data, [string, string]>({
  key: (userId) => `/user/${userId}/private`,
  get: (userId, token) => getPrivateData(userId, token),
});

privateData.get([userId, token]);
```

## Cache age

Each cache entry has a timestamp. Its age decides what a read does.

| Age                             | State   | What `get` does                                            |
| ------------------------------- | ------- | ---------------------------------------------------------- |
| Less than `freshAge`            | Fresh   | Returns the cached result. No fetch.                       |
| Less than `freshAge + staleAge` | Stale   | Returns the cached result and refetches in the background. |
| Older                           | Expired | Starts a fetch and returns a new pending result.           |

- `freshAge` defaults to `2000` milliseconds.
- `staleAge` defaults to `30000` milliseconds.
- Starting a background fetch resets the timestamp, so the entry is fresh again.
- Ages are only checked when the store is read or revalidated. Nothing expires on a timer.

Reads within `freshAge` share one fetch, so calling `get` many times does not send many requests. When a fetch settles after a newer write to the same key, its result is dropped.

## Revalidation

A store revalidates in these cases:

- `store.get` is called and the cache is stale or expired.
- `store.trigger` or the global `trigger` is called, and the store has subscribers.
- An event or polling option fires, and the store has subscribers.

A revalidation follows the cache age rules above, so a fresh entry is not refetched.

Events, polling and `trigger` fetch with the arguments of the newest subscriber that is still subscribed. This matters when a custom `key` leaves out an argument, such as a token.

### Lazy setup

Event listeners and polling start when a store gets its first subscriber for a key. They stop when that store's last subscriber for the key unsubscribes. Each store manages its own, even when stores share a key.

They only run on the client. An option is skipped when its events are missing, such as window focus in React Native or `document` visibility in a web worker.

### Events

| Option                   | Revalidates when                                  |
| ------------------------ | ------------------------------------------------- |
| `revalidateOnFocus`      | The window fires `focus`.                         |
| `revalidateOnVisibility` | The page fires `visibilitychange` and is visible. |
| `revalidateOnNetwork`    | The window fires `online`.                        |

All three default to `false`.

### Polling

Set `refreshInterval` to a number of milliseconds to revalidate on an interval. Polling runs all the time by default. These options limit it:

- `refreshWhenHidden` polls only while the page is hidden.
- `refreshWhenBlurred` polls only while the window is not focused.
- `refreshWhenOffline` polls only while the browser is offline.

When one or more of these options is set, polling only happens in those states. Polling starts right away when the page is already in that state.

## Initial data and hydration

`initialData` gives a store a value to return before the first fetch settles. Set it on the store, or pass it to `get` to override the store option.

```ts
const result = userStore.get(['123'], {
  initialData: prefetchedUser,
});
// { status: 'success', data: prefetchedUser }
```

By default initial data is only a placeholder.

- It is returned while there is no cache entry for the key.
- It does not count as fresh, so the first read still starts a fetch.
- It is not written to the cache.

Pass `hydrate: true` to write it to the cache instead. The entry then follows the cache age rules like fetched data. Use this when the value is known to be current, such as data the server rendered with.

```ts
userStore.get(['123'], {
  initialData: prefetchedUser,
  hydrate: true,
});
```

You can also write to the cache directly with `mutate`.

## Retries

When `get` throws or rejects, the store retries with exponential backoff.

- The first retry waits 10 milliseconds, and each wait doubles.
- `maxRetryInterval` caps the wait. It defaults to `5000` milliseconds.
- `maxRetryCount` limits the number of retries. By default the browser retries until the fetch succeeds, and the server does not retry.

The result stays pending while the store retries. It becomes a failure once the retries run out.

## Server rendering

The cache is shared by everything in the same JavaScript runtime. On a server, that would be every request, so the server never caches. This keeps one request from reading another request's data.

The store treats these as clients, and caches there:

- Pages with a `window`, including React Native.
- Dedicated and shared web workers.

Everything else is a server. That includes Node, Bun, Deno and edge runtimes such as Cloudflare Workers. On a server, the store behaves like this:

- `get` returns `initialData` as a success result when it is set, and does not fetch. `hydrate` has no effect.
- Without `initialData`, every `get` returns a new pending result. Its fetch starts when something awaits `data`, so a render that only checks `status` sends no request. Reads do not share fetches, even with the same key.
- A failed fetch is only retried when `maxRetryCount` is set. Unlimited retries would keep running after the request ends.
- `mutate`, `trigger` and `subscribe` do nothing.
- Event listeners and polling do not start.

Load data for the page before rendering, and pass it as `initialData`. On the client, pass the same value with `hydrate: true` so the cache starts from what the server rendered.

The bindings follow the same rules:

- The React and Preact `useSWRStore` return `initialData` when it is set. Without it, the non-suspense hook returns the pending result and does not fetch.
- With `suspense: true` and no `initialData`, the React and Preact hooks throw an error instead of suspending. Suspending would start a new fetch on every retry and never finish. The error makes the nearest `Suspense` boundary render its fallback on the server and retry on the client.
- The Solid `useSWRStore` fetches once per resource and waits for it during async server rendering.

## Comparing results

Before writing a fetched value, the store compares it with the cached value. When they are equal, the cached result is kept. Subscribers still get a new entry with `isValidating` set to `false`, but its `result` is the same object as before.

- The default comparison is a deep equality check from `dequal`.
- Set `compare` to use your own function. It receives the old and new values and returns `true` when they are equal.

## API

### `createSWRStore(options)`

Creates a store. Only `get` is required.

| Option                   | Type                         | Default                                 |
| ------------------------ | ---------------------------- | --------------------------------------- |
| `get`                    | `(...args: P) => Promise<T>` | Required                                |
| `name`                   | `string`                     | `undefined`                             |
| `key`                    | `(...args: P) => string`     | Name or id, then `JSON.stringify(args)` |
| `initialData`            | `T`                          | `undefined`                             |
| `freshAge`               | `number`                     | `2000`                                  |
| `staleAge`               | `number`                     | `30000`                                 |
| `compare`                | `(a: T, b: T) => boolean`    | Deep equality                           |
| `maxRetryCount`          | `number`                     | Unlimited                               |
| `maxRetryInterval`       | `number`                     | `5000`                                  |
| `revalidateOnFocus`      | `boolean`                    | `false`                                 |
| `revalidateOnVisibility` | `boolean`                    | `false`                                 |
| `revalidateOnNetwork`    | `boolean`                    | `false`                                 |
| `refreshInterval`        | `number`                     | `undefined`                             |
| `refreshWhenHidden`      | `boolean`                    | `false`                                 |
| `refreshWhenBlurred`     | `boolean`                    | `false`                                 |
| `refreshWhenOffline`     | `boolean`                    | `false`                                 |

Options set to `undefined` keep their default.

### `store.get(args, options?)`

Reads the cache entry for `args` and returns a `MutationResult<T>`. It may start a fetch, as described in [Cache age](#cache-age).

| Option             | Description                                                       | Default                 |
| ------------------ | ----------------------------------------------------------------- | ----------------------- |
| `shouldRevalidate` | When `false`, returns the cached result without checking its age. | `true`                  |
| `initialData`      | Returned when there is no cache entry.                            | The store `initialData` |
| `hydrate`          | Writes `initialData` to the cache.                                | `false`                 |

With `shouldRevalidate: false`, a read still starts a fetch when there is no cache entry and no initial data.

### `store.getKey(args)`

Returns the cache key for `args`. Pass it to the global `trigger`, `mutate` and `subscribe`.

### `store.subscribe(args, listener)`

Calls `listener` every time the cache entry for `args` is written. Returns a function that unsubscribes.

The listener receives the cache entry:

- `result` is the `MutationResult<T>`.
- `timestamp` is the time of the last write or revalidation.
- `isValidating` is `true` while a background fetch runs.

Subscribing also starts the event listeners and polling for the key. See [Lazy setup](#lazy-setup).

### `store.trigger(args, shouldRevalidate = true)`

Asks the subscribed stores for the key of `args` to revalidate. With `shouldRevalidate: false`, nothing is refetched.

### `store.mutate(args, result, shouldRevalidate = true, compare?)`

Writes `result` to the cache entry for `args` and notifies subscribers.

```ts
userStore.mutate(['123'], {
  status: 'success',
  data: { id: '123', name: 'John Doe' },
});
```

- When both the cached and new results are successes and `compare` says they are equal, the entry keeps its value. Its timestamp is reset and subscribers are not notified.
- `compare` defaults to the store `compare` option.
- With `shouldRevalidate: true`, subscribed stores fetch again after the write, even when the entry is fresh. The fetched data then replaces the written data. Pass `false` to keep the written data.

### `trigger(key, shouldRevalidate = true)`

The same as `store.trigger`, for a cache key.

### `mutate(key, result, shouldRevalidate = true, compare = dequal)`

The same as `store.mutate`, for a cache key.

### `setCacheSize(size)`

Sets how many entries the client cache keeps. It must be a positive integer. The default is `1000`. When the cache holds more entries, the least recently used ones are removed right away.

- Entries with subscribers are never removed. The cache can grow past the limit while more entries than that have subscribers.
- A removed entry is fetched again the next time it is read.

### `subscribe(key, listener)`

The same as `store.subscribe`, for a cache key. It does not start event listeners or polling.

```ts
import { mutate, subscribe, trigger } from 'swr-store';

const unsubscribe = subscribe('/user/123', (mutation) => {
  console.log(mutation.result);
});

trigger(userStore.getKey(['123']));
```

## Bindings

Each binding is a separate entry point. The framework is an optional peer dependency, so install only the one you use.

| Import             | Peer dependency         | Example                                                                            |
| ------------------ | ----------------------- | ---------------------------------------------------------------------------------- |
| `swr-store/react`  | `react` 18 or 19        | [examples/react](https://github.com/lxsmnsyc/swr-store/tree/main/examples/react)   |
| `swr-store/preact` | `preact` 10.11 or later | [examples/preact](https://github.com/lxsmnsyc/swr-store/tree/main/examples/preact) |
| `swr-store/solid`  | `solid-js` 1.6 or later | [examples/solid](https://github.com/lxsmnsyc/swr-store/tree/main/examples/solid)   |

### React and Preact

`useSWRStore(store, args, options?)` reads the store and re-renders when the cache entry changes.

```tsx
import { Suspense } from 'react';
import { useSWRStore } from 'swr-store/react';

function UserName(props: { id: string }) {
  const user = useSWRStore(userStore, [props.id], { suspense: true });

  return <span>{user.name}</span>;
}

function UserNameWithoutSuspense(props: { id: string }) {
  const result = useSWRStore(userStore, [props.id]);

  if (result.status === 'pending') {
    return <span>Loading...</span>;
  }
  if (result.status === 'failure') {
    return <span>Something went wrong.</span>;
  }
  return <span>{result.data.name}</span>;
}

export default function App() {
  return (
    <Suspense fallback={<span>Loading...</span>}>
      <UserName id="123" />
    </Suspense>
  );
}
```

For Preact, import from `swr-store/preact` and take `Suspense` from `preact/compat`.

| Option             | Description                                                                                        | Default                 |
| ------------------ | -------------------------------------------------------------------------------------------------- | ----------------------- |
| `suspense`         | When `true`, suspends while pending, throws the error on failure, and returns the data on success. | `false`                 |
| `initialData`      | Returned while there is no cache entry.                                                            | The store `initialData` |
| `shouldRevalidate` | When `false`, the first read does not check the cache age.                                         | `true`                  |

- Without `suspense`, the hook returns the `MutationResult<T>`.
- `args` are compared item by item, so passing a new array with the same values each render does not refetch.
- `SWRStoreRoot` is deprecated. The hook does not need it, and it only renders its children.

### Solid

`args` is a function, so the hooks follow reactive arguments.

```tsx
import { Suspense } from 'solid-js';
import { useSWRStore, useSWRStoreSuspenseless } from 'swr-store/solid';

function UserName(props: { id: string }) {
  const user = useSWRStore(userStore, (): [string] => [props.id]);

  return <span>{user()?.name}</span>;
}

function UserNameSuspenseless(props: { id: string }) {
  const result = useSWRStoreSuspenseless(userStore, (): [string] => [props.id]);

  const label = () => {
    const current = result();
    if (current.status === 'pending') {
      return 'Loading...';
    }
    if (current.status === 'failure') {
      return 'Something went wrong.';
    }
    return current.data.name;
  };

  return <span>{label()}</span>;
}

export default function App() {
  return (
    <Suspense fallback={<span>Loading...</span>}>
      <UserName id="123" />
    </Suspense>
  );
}
```

- `useSWRStore(store, args, options?)` returns a `Resource<T | undefined>`. It suspends while pending and holds the error on failure.
- `useSWRStoreSuspenseless(store, args, options?)` returns an accessor for the `MutationResult<T>` and never suspends.

Both accept `initialData`, `shouldRevalidate` and `hydrate`, with the same meaning as in [`store.get`](#storegetargs-options).

## License

MIT © [lxsmnsyc](https://github.com/lxsmnsyc)
