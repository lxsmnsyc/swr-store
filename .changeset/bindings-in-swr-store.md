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
- The server no longer caches results. The cache was shared by every request in the process, so one request could read another request's data. On the server, `get` now returns `initialData` or starts a new fetch, `mutate`, `trigger` and `subscribe` do nothing, and failed fetches are only retried when `maxRetryCount` is set.
- With `suspense: true` and no `initialData`, the React and Preact `useSWRStore` throw an error on the server instead of suspending, so the `Suspense` boundary renders on the client.
- The browser cache now keeps up to 1000 entries and removes the least recently used ones. Use the new `setCacheSize` to change the limit.
- A failed fetch no longer throws a `window is not defined` error when retrying on the server.
- The package is built with tsdown. ESM and CommonJS builds are still published, but the separate `development` builds are gone.
