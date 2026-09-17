---
'swr-store': major
---

The React, Preact and Solid bindings now ship inside `swr-store`.

- Import them from `swr-store/react`, `swr-store/preact` and `swr-store/solid`. They replace the `react-swr-store`, `preact-swr-store` and `solid-swr-store` packages.
- `react`, `preact` and `solid-js` are optional peer dependencies. Install only the one you use.
- The React binding supports React 18 and 19, and the Preact binding needs Preact 10.11 or later. Both use `useSyncExternalStore` and no longer need `SWRStoreRoot`. The component is still exported but only renders its children.
- The `suspense` option of the React and Preact `useSWRStore` can be left out.
- The Solid hooks now read the new result when their arguments change, and `options` can be left out.
- `initialData` that is not hydrated no longer stops the first fetch. Before, a store with `initialData` never fetched on its own.
- Store and `get` options set to `undefined` now keep their defaults. Before, passing `initialData: undefined` to `get` ignored the store's `initialData`.
- Falsy `initialData`, such as `0` or `''`, is no longer ignored.
- Events, polling and `trigger` now fetch with the arguments of the newest active subscriber, instead of the first one ever.
- The server no longer caches results. The cache was shared by every request in the process, so one request could read another request's data. React Native and web workers still cache. On the server, `get` now returns `initialData` or a new pending result whose fetch starts when it is awaited, `mutate`, `trigger` and `subscribe` do nothing, and failed fetches are only retried when `maxRetryCount` is set.
- With `suspense: true` and no `initialData`, the React and Preact `useSWRStore` throw an error on the server instead of suspending, so the `Suspense` boundary renders on the client.
- The client cache now keeps up to 1000 entries and removes the least recently used ones that have no subscribers. Use the new `setCacheSize` to change the limit.
- A failed fetch no longer throws a `window is not defined` error when retrying on the server.
- The default key now starts with the store's id, so two stores called with the same arguments no longer read each other's data. Set the new `name` option to use a stable prefix for stores that are created more than once. Use the new `store.getKey(args)` to get a key for the global `trigger`, `mutate` and `subscribe`.
- Event listeners and polling are now set up and removed per store. Before, stores that shared a key could leave listeners running after every subscriber left, or never set them up when a global subscriber came first.
- `isValidating` now goes back to `false` when a refetch returns equal data. Subscribers are notified when it changes.
- A fetch that is replaced by a newer one now settles with the newer fetch's result. Before, its promise never settled, which could leave a suspended component waiting forever.
- `mutate` now writes before revalidating, and with `shouldRevalidate` it fetches even when the entry is fresh. The fetched data replaces the written data.
- `trigger` with `shouldRevalidate: false` now does nothing.
- Event and polling options are skipped when their events are missing, such as in React Native, instead of throwing.
- `refreshWhenHidden`, `refreshWhenBlurred` and `refreshWhenOffline` start polling right away when the page is already in that state.
- The `Mutation` and `MutationListener` types are now exported.
- The package is built with tsdown. ESM and CommonJS builds are still published, but the separate `development` builds are gone.
