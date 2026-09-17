# Migrating from 0.10 to 1.0

Version 1.0 moves the React, Preact and Solid bindings into `swr-store`, requires a `key` for every store, and changes how you write to the cache. This guide lists every change that can break your code, in the order you are likely to hit them.

## Checklist

1. Install `swr-store` 1.0 and remove `react-swr-store`, `preact-swr-store` and `solid-swr-store`.
2. Import the hooks from `swr-store/react`, `swr-store/preact` or `swr-store/solid`.
3. Remove `SWRStoreRoot`.
4. Add a `key` to every store that does not have one.
5. Rename `shouldRevalidate` to `revalidate`.
6. Update `mutate` and `trigger` calls.
7. Replace `hydrate: true` in `get` with `store.hydrate`.
8. Rename the `Mutation*` types.
9. Check the [behavior changes](#behavior-changes), especially server rendering.

## Requirements

- Node.js 20 or later.
- React 18 or 19. React 16 and 17 are no longer supported.
- Preact 10.11 or later.
- Solid 1.6 or later.
- In TypeScript, `moduleResolution` set to `bundler`, `node16` or `nodenext`. The `swr-store/*` entry points do not resolve with `node` (`node10`).

## Packages and imports

The binding packages are replaced by entry points of `swr-store`. `react`, `preact` and `solid-js` are optional peer dependencies, so install only the one you use.

```bash
npm uninstall react-swr-store preact-swr-store solid-swr-store
npm install swr-store@^1
```

```ts
// Before
import { useSWRStore } from 'react-swr-store';
import { useSWRStore } from 'preact-swr-store';
import { useSWRStore, useSWRStoreSuspenseless } from 'solid-swr-store';

// After
import { useSWRStore } from 'swr-store/react';
import { useSWRStore } from 'swr-store/preact';
import { useSWRStore, useSWRStoreSuspenseless } from 'swr-store/solid';
```

The default export of `react-swr-store` is gone. Use the named `useSWRStore` export.

## `SWRStoreRoot` is removed

The React and Preact hooks use `useSyncExternalStore` and need no root component. Remove `SWRStoreRoot` from your tree.

```tsx
// Before
<SWRStoreRoot>
  <App />
</SWRStoreRoot>

// After
<App />
```

## `key` is required

Stores no longer build a key from `JSON.stringify(args)`. Every store needs a `key` function. Build the key from what makes the data unique, such as an id.

```ts
// Before
const userStore = createSWRStore<User, [string]>({
  get: (id) => getUser(id),
});

// After
const userStore = createSWRStore<User, [string]>({
  key: (id) => `/user/${id}`,
  get: (id) => getUser(id),
});
```

- Stores that return the same key share a cache entry. Give different stores different keys, for example with a prefix.
- The key can leave out arguments that do not change the data, such as an auth token.
- The global `trigger`, `mutate`, `setResult` and `subscribe` take a key. Use `store.getKey(args)` to get it instead of building the key by hand.

## `shouldRevalidate` is renamed to `revalidate`

The option is renamed in `store.get` and in every hook. Its meaning is the same.

```ts
// Before
store.get(['123'], { shouldRevalidate: false });
useSWRStore(store, ['123'], { shouldRevalidate: false });

// After
store.get(['123'], { revalidate: false });
useSWRStore(store, ['123'], { revalidate: false });
```

## `mutate` takes data and an options object

`mutate` now takes the data itself instead of a result object. The `shouldRevalidate` and `compare` arguments move into an options object.

```ts
// Before
store.mutate(['123'], { status: 'success', data: user });
store.mutate(['123'], { status: 'success', data: user }, false);
store.mutate(['123'], { status: 'success', data: user }, true, isSameUser);
mutate('/user/123', { status: 'success', data: user }, false);

// After
store.mutate(['123'], user);
store.mutate(['123'], user, { revalidate: false });
store.mutate(['123'], user, { compare: isSameUser });
mutate('/user/123', user, { revalidate: false });
```

`mutate` also accepts a function. It receives the cached data, or `undefined` when the entry holds no data.

```ts
store.mutate(['123'], (user) => ({ ...user!, name: 'Jane Doe' }), { revalidate: false });
```

Because of this, data that is itself a function has to be written with `setResult`.

### Writing pending or failed results

Use the new `setResult` to write a result that is not a success. It takes the same options as `mutate`.

```ts
// Before
store.mutate(['123'], { status: 'failure', data: error }, false);

// After
store.setResult(['123'], { status: 'failure', data: error }, { revalidate: false });
```

The global `setResult(key, result, options?)` works the same way with a key.

## `trigger` has no second argument

`trigger(args, false)` only read the cache, which rarely did anything useful, so the argument is removed.

```ts
// Before
store.trigger(['123'], true);
trigger('/user/123', true);

// After
store.trigger(['123']);
trigger('/user/123');
```

Remove any `trigger` calls that passed `false`.

## `hydrate` in `get` is replaced by `store.hydrate`

`store.get` no longer accepts `hydrate`. Call `store.hydrate(args, data)` to write data to the cache.

```ts
// Before
const result = store.get(['123'], { initialData: user, hydrate: true });

// After
store.hydrate(['123'], user);
const result = store.get(['123']);
```

- `store.hydrate` returns nothing. Call `store.get` if you used the result.
- Without `data`, it writes the store `initialData`.
- It keeps an existing entry, unless the entry is still pending on the key's first load. Then it replaces the entry and stops the fetch.
- It does nothing on the server.

The Solid hooks still accept `hydrate: true`, and the React and Preact hooks now accept it too. They call `store.hydrate` with `initialData`, or with the store `initialData`, once per key per page.

## Renamed and removed types

| 0.10              | 1.0          |
| ----------------- | ------------ |
| `MutationResult`  | `SWRResult`  |
| `MutationPending` | `SWRPending` |
| `MutationSuccess` | `SWRSuccess` |
| `MutationFailure` | `SWRFailure` |

`SWREntry` and `SWRListener` are new exports. They describe the cache entry a subscriber receives.

These types are no longer exported. Use `SWRStore` and `SWRStoreOptions` instead.

- `SWRTrigger`, `SWRMutate`, `SWRGet` and `SWRSubscribe`. Use `SWRStore<T, P>['trigger']` and the like.
- `SWRStoreBaseOptions`, `SWRStoreExtendedOptions`, `SWRStorePartialOptions` and `SWRFullOptions`.

The new `SWRMutateOptions` and `SWRMutateValue` types describe the `mutate` arguments.

`store.id` is removed.

## Hook changes

### React and Preact

- `suspense` can be left out, and can be a `boolean` variable. The return type is then `T | SWRResult<T>`.
- The hook compares cache keys, not argument arrays. Passing a new `args` array with the same key each render no longer resubscribes.
- `initialData` only applies to the first key the hook reads. Changing it later does nothing, and a new key does not show it.
- With `suspense: true` and no `initialData`, the hook throws an error on the server instead of suspending. The nearest `Suspense` boundary then renders on the client. Pass `initialData` if the content must render on the server.
- On React 19, the hook suspends with `use`. On React 18 and in Preact, it throws the promise.

### Solid

- `options` can be left out.
- `initialData` only applies to the first key the hooks read. Before, a new key also showed it.
- The hooks keep their subscription when the arguments change but the key does not.
- Store reads no longer track signals, so signals read inside `get` or `key` do not rerun the hooks.
- `useSWRStore` writes data from server rendering to the cache during hydration, instead of fetching it again.

## Behavior changes

These changes need no code change, but can change what your app does.

### The server has no cache

In 0.10 the cache was shared by every request in the server process, so one request could read another request's data. In 1.0 the server never caches.

- `get` returns `initialData` when it is set, and does not fetch.
- Without `initialData`, every `get` returns a new pending result. Its fetch starts when something awaits `data`.
- `hydrate`, `mutate`, `setResult`, `trigger` and `subscribe` do nothing. An updater passed to `mutate` is not called.
- A failed fetch is only retried when `maxRetryCount` is set.

Load data before rendering and pass it as `initialData`. On the client, pass the same data to `store.hydrate`, or to a hook with `hydrate: true`.

Pages with a `window` (including React Native) and dedicated or shared web workers still cache. Node, Bun, Deno and edge runtimes are treated as servers.

### Initial data

- `initialData` without hydration no longer stops the first fetch. It is shown until the fetch settles.
- Falsy `initialData`, such as `0` or `''`, is no longer ignored.
- Options set to `undefined` keep their default. `get(args, { initialData: undefined })` now falls back to the store's `initialData`.

### Cache size

The client cache keeps up to 1000 entries and removes the least recently used ones. Entries with subscribers or a running fetch are kept. Call `setCacheSize` to change the limit.

```ts
import { setCacheSize } from 'swr-store';

setCacheSize(5000);
```

### Fetching and writes

- A key has at most one running fetch. Reads share it instead of starting another.
- `mutate`, `setResult` and `hydrate` stop a running fetch whose result they would make useless. Its promise settles with the written result.
- Freshness counts from when a fetch settles, not from when it started.
- A fetch result is dropped when the key was written after the fetch started, even within the same millisecond.
- `mutate` writes first and then revalidates. With `revalidate` (the default), it fetches even when the entry is fresh, and the fetched data replaces the written data. Pass `{ revalidate: false }` to keep the written data.
- A cached failure has no stale time. Once it is no longer fresh, a read returns a new pending result.

### Notifications

- Writes made by a read, such as `get` starting a fetch, and by `hydrate` notify subscribers in a microtask.
- `isValidating` goes back to `false` when a refetch returns equal data, and subscribers are notified.
- A listener or `compare` that throws no longer stops other listeners. The error is passed to `reportError`.

### Events and polling

- Event listeners and polling are set up per store, when the store gets its first subscriber for a key.
- Events, polling and `trigger` fetch with the arguments of the newest active subscriber.
- Several `refreshWhen*` options share one interval. Polling starts right away when the page is already in one of those states.
- A `refreshInterval` of `0` or less does not poll.
- Options whose events are missing, such as window focus in React Native, are skipped instead of throwing.

## Build output

The package is built with tsdown and targets ES2020. It still publishes ESM and CommonJS, but the separate `development` builds are gone.
