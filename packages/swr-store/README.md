# swr-store

> Reactive stores for data fetching with the stale-while-revalidate strategy.

[![NPM](https://img.shields.io/npm/v/swr-store.svg)](https://www.npmjs.com/package/swr-store)

A store wraps an async function. Reading the store returns the cached result right away and refetches in the background when the cache gets old. Subscribers are notified when the cache changes.

The package has no framework dependency. Bindings for React, Preact and Solid ship as separate entry points.

Upgrading from 0.10? See the [migration guide](https://github.com/lxsmnsyc/swr-store/blob/main/packages/swr-store/MIGRATION.md).

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
import type { SWRResult } from 'swr-store';
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

const unsubscribe = userStore.subscribe(['123'], (entry) => {
  render(entry.result);
});

// Starts the fetch and returns a pending result.
render(userStore.get(['123']));

function render(result: SWRResult<User>) {
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

Reading a store returns a `SWRResult<T>`. Check `status` to find out what `data` holds.

| `status`    | `data`                                                |
| ----------- | ----------------------------------------------------- |
| `'pending'` | A `Promise<T>` for the running fetch.                 |
| `'success'` | The fetched value, of type `T`.                       |
| `'failure'` | The error thrown by `get`, after the retries ran out. |

## Keys and the shared cache

In the browser, every store writes to one global cache. Each store needs a `key` function that turns its arguments into a cache key. Build the key from what makes the data unique, such as an id.

```ts
const userStore = createSWRStore<User, [string]>({
  key: (id) => `/user/${id}`,
  get: (id) => getUser(id),
});
```

- Stores that produce the same key share the same cache entry.
- The key can leave out arguments that do not change the data, such as an auth token.
- The global `trigger`, `mutate`, `setResult` and `subscribe` functions take a key instead of arguments. Use `store.getKey(args)` to get it.
- The cache keeps up to 1000 entries. When it is full, the least recently used entry is removed. Entries with subscribers or a running fetch are kept, and so is the entry used last. Change the limit with [`setCacheSize`](#setcachesizesize).

```ts
const privateData = createSWRStore<Data, [string, string]>({
  key: (userId) => `/user/${userId}/private`,
  get: (userId, token) => getPrivateData(userId, token),
});

privateData.get([userId, token]);
```

Create stores once at module level. The hooks treat a new store object as a new source, so creating a store during render subscribes again on every render.

The server has no cache. See [Server rendering](#server-rendering).

## Cache age

Each cache entry has a timestamp from when it was last written, such as when its fetch settled. Its age decides what a read does.

| Age                             | State   | What `get` does                                            |
| ------------------------------- | ------- | ---------------------------------------------------------- |
| Less than `freshAge`            | Fresh   | Returns the cached result. No fetch.                       |
| Less than `freshAge + staleAge` | Stale   | Returns the cached result and refetches in the background. |
| Older                           | Expired | Starts a fetch and returns a new pending result.           |

A cached failure has no stale time. Once it is no longer fresh, a read returns a new pending result instead of the old error.

- `freshAge` defaults to `2000` milliseconds.
- `staleAge` defaults to `30000` milliseconds.
- Ages are only checked when the store is read or revalidated. Nothing expires on a timer.

A key has at most one running fetch. Reads that would fetch while one runs return the cached result, or the running fetch's pending result, instead of starting another. Writes with `mutate`, `setResult` or `hydrate` stop a running fetch, since its result would be dropped. Its promise settles with the written result, and a later read can fetch again right away.

When a fetch settles after a newer write to the same key, its result is dropped. Writes are ordered by when they happened, not by their timestamps, so this also holds within the same millisecond.

## Revalidation

A store revalidates in these cases:

- `store.get` is called and the cache is stale or expired.
- `store.trigger` or the global `trigger` is called, and the store has subscribers.
- An event or polling option fires, and the store has subscribers.

A revalidation follows the cache age rules above, so a fresh entry is not refetched.

Events, polling and `trigger` fetch with the arguments of the newest subscriber that is still subscribed. This matters when a custom `key` leaves out an argument, such as a token.

### Lazy setup

Event listeners and polling start when a store gets its first subscriber for a key. They stop when that store's last subscriber for the key unsubscribes. Each store manages its own, even when stores share a key.

They only run on the client. An event option is skipped when its events are missing, such as window focus in React Native or `document` visibility in a web worker.

### Events

| Option                   | Revalidates when                                  |
| ------------------------ | ------------------------------------------------- |
| `revalidateOnFocus`      | The window fires `focus`.                         |
| `revalidateOnVisibility` | The page fires `visibilitychange` and is visible. |
| `revalidateOnNetwork`    | The window fires `online`.                        |

All three default to `false`.

### Polling

Set `refreshInterval` to a number of milliseconds, greater than `0`, to revalidate on an interval. Polling runs all the time by default. These options limit it:

- `refreshWhenHidden` polls only while the page is hidden.
- `refreshWhenBlurred` polls only while the window is not focused.
- `refreshWhenOffline` polls only while the browser is offline.

When one or more of these options is set, a single interval runs while the page is in any of those states. Polling starts right away when the page is already in one of them. When none of the chosen states can be detected, such as in React Native, polling runs all the time.

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

To write known current data to the cache, such as data the server rendered with, use `store.hydrate`. The entry then follows the cache age rules like fetched data.

```ts
userStore.hydrate(['123'], prefetchedUser);
```

- Without `data`, the store `initialData` is written.
- An existing entry is kept, since the cache already has newer work for the key.
- The one exception is an entry that is still pending on the key's first load. It is replaced, and its fetch stops.
- It returns nothing. Call `store.get` to read the result.

You can also write to the cache directly with [`mutate`](#storemutateargs-value-options).

## Retries

When `get` throws or rejects, the store retries with exponential backoff.

- The first retry waits 10 milliseconds, and each wait doubles.
- `maxRetryInterval` caps the wait, even below 10 milliseconds. It defaults to `5000` milliseconds. Attempts are always at least 1 millisecond apart.
- `maxRetryCount` limits the number of retries. By default the browser retries until the fetch succeeds, and the server does not retry.

The result stays pending while the store retries. It becomes a failure once the retries run out.

This also applies to a background refetch of successful data. When its retries run out, the failure replaces the cached data. Keep `maxRetryCount` unset if cached data should stay until a fetch succeeds.

## Server rendering

The cache is shared by everything in the same JavaScript runtime. On a server, that would be every request, so the server never caches. This keeps one request from reading another request's data.

The store treats these as clients, and caches there:

- Pages with a `window`, including React Native.
- Dedicated and shared web workers.

Everything else is a server. That includes Node, Bun, Deno and edge runtimes such as Cloudflare Workers. On a server, the store behaves like this:

- `get` returns `initialData` as a success result when it is set, and does not fetch.
- Without `initialData`, every `get` returns a new pending result. Its fetch starts when something awaits `data`, so a render that only checks `status` sends no request. Reads do not share fetches, even with the same key.
- A failed fetch is only retried when `maxRetryCount` is set. Unlimited retries would keep running after the request ends.
- `hydrate`, `mutate`, `setResult`, `trigger` and `subscribe` do nothing.
- Event listeners and polling do not start.

Load data for the page before rendering, and pass it as `initialData`. On the client, pass the same value to `store.hydrate`, or to a hook with `hydrate: true`, so the cache starts from what the server rendered.

The bindings follow the same rules:

- The React and Preact `useSWRStore` return `initialData` when it is set. Without it, the non-suspense hook returns the pending result and does not fetch.
- With `suspense: true` and no `initialData`, the React and Preact hooks throw an error instead of suspending. Suspending would start a new fetch on every retry and never finish. The error makes the nearest `Suspense` boundary render its fallback on the server and retry on the client.
- The Solid `useSWRStore` fetches once per resource and waits for it during async server rendering.

## Comparing results

Before writing a fetched value, the store compares it with the cached value. When they are equal, the cached result is kept, and the entry becomes fresh again. Subscribers still get a new entry with `isValidating` set to `false`, but its `result` is the same object as before.

- The default comparison is a deep equality check from `dequal`.
- Set `compare` to use your own function. It receives the old and new values and returns `true` when they are equal.

## API

### `createSWRStore(options)`

Creates a store. `get` and `key` are required.

| Option                   | Type                         | Default       |
| ------------------------ | ---------------------------- | ------------- |
| `get`                    | `(...args: P) => Promise<T>` | Required      |
| `key`                    | `(...args: P) => string`     | Required      |
| `initialData`            | `T`                          | `undefined`   |
| `freshAge`               | `number`                     | `2000`        |
| `staleAge`               | `number`                     | `30000`       |
| `compare`                | `(a: T, b: T) => boolean`    | Deep equality |
| `maxRetryCount`          | `number`                     | Unlimited     |
| `maxRetryInterval`       | `number`                     | `5000`        |
| `revalidateOnFocus`      | `boolean`                    | `false`       |
| `revalidateOnVisibility` | `boolean`                    | `false`       |
| `revalidateOnNetwork`    | `boolean`                    | `false`       |
| `refreshInterval`        | `number`                     | `undefined`   |
| `refreshWhenHidden`      | `boolean`                    | `false`       |
| `refreshWhenBlurred`     | `boolean`                    | `false`       |
| `refreshWhenOffline`     | `boolean`                    | `false`       |

Options set to `undefined` keep their default.

### `store.get(args, options?)`

Reads the cache entry for `args` and returns a `SWRResult<T>`. It may start a fetch, as described in [Cache age](#cache-age).

| Option        | Description                                                       | Default                 |
| ------------- | ----------------------------------------------------------------- | ----------------------- |
| `revalidate`  | When `false`, returns the cached result without checking its age. | `true`                  |
| `initialData` | Returned when there is no cache entry.                            | The store `initialData` |

With `revalidate: false`, a read still starts a fetch when there is nothing to show: no cache entry and no initial data.

### `store.getKey(args)`

Returns the cache key for `args`. Pass it to the global `trigger`, `mutate`, `setResult` and `subscribe`.

### `store.subscribe(args, listener)`

Calls `listener` every time the cache entry for `args` is written. Returns a function that unsubscribes.

- Writes from fetch results, `mutate` and `setResult` notify right away.
- A listener that throws does not stop the others. Its error is passed to `reportError` where available, or thrown from a microtask.
- Writes made by a read, such as `get` starting a fetch, and by `hydrate` notify in a microtask. A read can happen while a UI library renders, and notifying right away would update other components in the middle of that render.
- A write that notifies right away also covers a notification still waiting for its microtask, so a listener is not called twice with the same entry.

The listener receives the cache entry:

- `result` is the `SWRResult<T>`.
- `timestamp` is the time of the last write or revalidation.
- `isValidating` is `true` while a background fetch runs.

Subscribing also starts the event listeners and polling for the key. See [Lazy setup](#lazy-setup).

### `store.trigger(args)`

Asks the subscribed stores for the key of `args` to revalidate. A fresh entry is not fetched again.

### `store.mutate(args, value, options?)`

Writes successful data to the cache entry for `args` and notifies subscribers. `value` is the new data, or a function that receives the cached data and returns the new data.

```ts
userStore.mutate(['123'], { id: '123', name: 'John Doe' });

userStore.mutate(['123'], (user) => ({ ...user!, name: 'Jane Doe' }), { revalidate: false });
```

| Option       | Description                                                                                                                                | Default             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| `revalidate` | When `true`, subscribed stores fetch again after the write, even when the entry is fresh. The fetched data then replaces the written data. | `true`              |
| `compare`    | Checks whether the new data equals the cached data.                                                                                        | The store `compare` |

- The function receives `undefined` when the entry holds no data, such as while it is pending or failed.
- Data that is itself a function has to be written with `setResult`.
- When the cached and new data are equal, the entry keeps its value and its timestamp is reset. Subscribers are only notified when this ends a revalidation, so `isValidating` goes back to `false`.
- When several stores share the key, only one fetch starts.

### `store.setResult(args, result, options?)`

Writes any `SWRResult<T>` to the cache entry for `args`, such as a failure. It takes the same options as `store.mutate`.

```ts
userStore.setResult(['123'], { status: 'failure', data: new Error('Not found') });
```

- A pending `result` is replaced by its outcome once its promise settles, unless something else was written to the key first.

### `store.hydrate(args, data?)`

Writes `data`, or the store `initialData`, to the cache entry for `args` as a success. An existing entry is kept, unless it is still pending on the key's first load. See [Initial data and hydration](#initial-data-and-hydration).

### `trigger(key)`

The same as `store.trigger`, for a cache key.

### `mutate(key, value, options?)`

The same as `store.mutate`, for a cache key. `compare` defaults to deep equality.

TypeScript cannot infer the type from an updater function, so pass it explicitly: `mutate<User>(key, (user) => ...)`.

### `setResult(key, result, options?)`

The same as `store.setResult`, for a cache key. `compare` defaults to deep equality.

### `setCacheSize(size)`

Sets how many entries the client cache keeps. It must be a positive integer. The default is `1000`. When the cache holds more entries, the least recently used ones are removed right away.

- Entries with subscribers or a running fetch are never removed, and neither is the entry used last. The cache can grow past the limit while more entries than that are kept.
- A removed entry is fetched again the next time it is read.

### `subscribe(key, listener)`

The same as `store.subscribe`, for a cache key. It does not start event listeners or polling.

```ts
import { subscribe, trigger } from 'swr-store';

const unsubscribe = subscribe('/user/123', (entry) => {
  console.log(entry.result);
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

| Option        | Description                                                                                        | Default                 |
| ------------- | -------------------------------------------------------------------------------------------------- | ----------------------- |
| `suspense`    | When `true`, suspends while pending, throws the error on failure, and returns the data on success. | `false`                 |
| `initialData` | Returned while there is no cache entry.                                                            | The store `initialData` |
| `hydrate`     | Writes `initialData`, or the store `initialData`, to the cache with `store.hydrate`.               | `false`                 |
| `revalidate`  | When `false`, the hook does not revalidate after mounting.                                         | `true`                  |

- Without `suspense`, the hook returns the `SWRResult<T>`.
- Rendering only reads the cache. It starts a fetch only when there is nothing to show. The hook revalidates once, after the component mounts. A render retried after suspending therefore shows the data it waited for, even when that data has already expired.
- On React 19, the hook suspends with `use`. React 18 has no `use`, so there the hook throws the promise to wait on, which React 18 also supports. Preact always throws the promise.
- A suspended component waits for its fetch or for the next write to its cache entry, whichever comes first. A `mutate` ends the suspense even when the fetch is still running.
- With `suspense`, a cached failure is thrown while it is fresh. After that, rendering fetches again and suspends. Resetting an error boundary therefore retries once the failure is older than `freshAge`.
- The hook compares cache keys, so passing new `args` objects with the same contents each render does not refetch. When `args` change but the key does not, such as a new token the key leaves out, later fetches and revalidations use the newest `args`. `initialData` and `hydrate` only apply to the first key the hook reads, so a new `initialData` object each render is fine. After the key changes, the hook shows the new key's own result.
- With `hydrate`, the hook hydrates a key once per page. A hook that mounts later, for example after the entry expired, does not write the initial data again.
- `suspense` can be a `boolean` variable. The return type is then `T | SWRResult<T>`.
- During hydration, the React hook first renders what the server rendered, which is `initialData` or the pending result. It then updates to the cached result. This keeps the first client render matching the server HTML. Without `suspense`, a pending result from the server snapshot holds a promise that fetches outside the cache when awaited, so render its `status` instead of awaiting its `data`.

### Solid

`args` is a function, so the hooks follow reactive arguments. When the arguments change but the key does not, the hooks keep their subscription and use the newest arguments. Signals read by the store's `get` or `key` are not tracked.

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

- `initialData` and `hydrate` only apply to the first key the hooks read.
- A hook hydrates a key once per page. A hook that mounts later does not write the initial data again.
- `useSWRStore(store, args, options?)` returns a `Resource<T | undefined>`. It suspends while pending and holds the error on failure. Like the React hook, a `mutate` ends the suspense even when the fetch is still running.
- During hydration, `useSWRStore` uses the data from server rendering and writes it to the cache, instead of fetching it again. With `initialData` and no `hydrate`, the initial data stays a placeholder and the client fetches. When the server failed, the client fetches too. The server data also replaces a fetch that another reader of the key, such as `useSWRStoreSuspenseless`, started first.
- `useSWRStoreSuspenseless(store, args, options?)` returns an accessor for the `SWRResult<T>` and never suspends.

Both accept `initialData` and `revalidate`, with the same meaning as in [`store.get`](#storegetargs-options), and `hydrate`, which writes `initialData` with [`store.hydrate`](#storehydrateargs-data).

## License

MIT © [lxsmnsyc](https://github.com/lxsmnsyc)
