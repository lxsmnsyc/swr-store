# swr-store

## 1.0.0

### Major Changes

- 2f03267: The React, Preact and Solid bindings now ship inside `swr-store`, and the store API is simpler and safer. See the [migration guide](https://github.com/lxsmnsyc/swr-store/blob/main/packages/swr-store/MIGRATION.md) for how to upgrade.

  ### Breaking changes

  #### Packages
  - The bindings are now imported from `swr-store/react`, `swr-store/preact` and `swr-store/solid`. They replace the `react-swr-store`, `preact-swr-store` and `solid-swr-store` packages.
  - `react`, `preact` and `solid-js` are optional peer dependencies. Install only the one you use.
  - The React binding supports React 18 and 19. The Preact binding needs Preact 10.11 or later.
  - `SWRStoreRoot` is removed. The React and Preact hooks use `useSyncExternalStore` and no longer need it.
  - The package is built with tsdown and targets ES2020. ESM and CommonJS builds are still published, but the separate `development` builds are gone.

  #### Store API
  - `key` is now required. Build it from what makes the data unique, such as an id. The default key, which serialized the arguments, is gone.
  - `store.mutate(args, value, options?)` and the global `mutate(key, value, options?)` now take the data, or a function that receives the cached data and returns the new data.
  - `mutate` takes its options as an object: `{ revalidate, compare }`. `revalidate` defaults to `true`.
  - `trigger` no longer takes a `shouldRevalidate` argument.
  - The `hydrate` option of `get` is replaced by `store.hydrate(args, data?)`.
  - The `shouldRevalidate` option of `get` and the hooks is renamed to `revalidate`.
  - `MutationResult`, `MutationPending`, `MutationSuccess` and `MutationFailure` are renamed to `SWRResult`, `SWRPending`, `SWRSuccess` and `SWRFailure`.
  - `store.id` is removed.
  - The `SWRTrigger`, `SWRMutate`, `SWRGet`, `SWRSubscribe`, `SWRStoreBaseOptions`, `SWRStoreExtendedOptions`, `SWRStorePartialOptions` and `SWRFullOptions` types are no longer exported. Use `SWRStore` and `SWRStoreOptions` instead.

  #### Behavior
  - The server no longer caches results. The cache was shared by every request in the process, so one request could read another request's data.
    - React Native and web workers still cache.
    - On the server, `get` returns `initialData`, or a new pending result whose fetch starts when it is awaited.
    - On the server, `hydrate`, `mutate`, `setResult`, `trigger` and `subscribe` do nothing.
    - On the server, failed fetches are only retried when `maxRetryCount` is set.
  - With `suspense: true` and no `initialData`, the React and Preact hooks throw an error on the server instead of suspending, so the `Suspense` boundary renders on the client.
  - `initialData` that is not hydrated no longer stops the first fetch. Before, a store with `initialData` never fetched on its own.
  - `mutate` now writes before revalidating. With `revalidate`, it fetches even when the entry is fresh, and the fetched data replaces the written data.
  - A read that writes to the cache, such as `get` starting a fetch, now notifies subscribers in a microtask. React no longer warns about updating a component while rendering a different one.
  - `initialData` in the hooks only applies to the first key they read.
  - The React and Preact hooks now only read the cache while rendering and revalidate once after mounting.

  ### New features
  - `setResult(args, result, options?)` writes any result, such as a pending or failed one. A pending result is replaced by its outcome once its promise settles.
  - `store.hydrate(args, data?)` writes server data, or the store `initialData`, to the cache. An existing entry is kept, unless it is still pending on the key's first load.
  - The hooks accept `hydrate`, and hydrate each key once per page.
  - `store.getKey(args)` returns the cache key for the global `trigger`, `mutate`, `setResult` and `subscribe`.
  - The client cache keeps up to 1000 entries and removes the least recently used ones. Use the new `setCacheSize` to change the limit.
  - The `SWREntry` and `SWRListener` types are exported.
  - The `suspense` option of the React and Preact hooks can be left out, or be a `boolean` variable.
  - The React hook suspends with `use` on React 19, and throws the promise on React 18.
  - The Solid hooks accept no `options`.

  ### Fixes

  #### Fetching and writes
  - A key now has at most one running fetch. Stale reads share it, so a failing background fetch no longer starts another endless retry loop on every read.
  - `mutate`, `setResult` and `hydrate` stop a running fetch whose result they would make useless, so a failing fetch no longer blocks new fetches for the key.
  - A fetch that is replaced by a newer one now settles with the newer fetch's result. Before, its promise never settled, which could leave a suspended component waiting forever.
  - Fetch results are ordered against writes by write order instead of timestamps, so a `mutate` in the same millisecond as a fetch start is no longer overwritten.
  - A fetch remembers writes to its key even after the entry was evicted, so it can no longer overwrite a newer `mutate`.
  - Freshness counts from when a fetch settles. Slow fetches are no longer stale or thrown away when they arrive.
  - A cached failure no longer has a stale time.
  - `mutate` starts one fetch when several stores share the key, instead of one per store.
  - A read with `initialData` no longer starts a second fetch.
  - A failed fetch no longer throws a `window is not defined` error when retrying on the server.
  - `maxRetryInterval` now caps retry waits below 10 milliseconds.

  #### Options
  - Store and `get` options set to `undefined` keep their defaults. Before, passing `initialData: undefined` to `get` ignored the store's `initialData`.
  - Falsy `initialData`, such as `0` or `''`, is no longer ignored.

  #### Cache and notifications
  - The cache keeps entries with a running fetch and the entry written last. A suspended component no longer fetches forever when every other entry has subscribers.
  - `isValidating` goes back to `false` when a refetch or a `mutate` returns equal data, and subscribers are notified when it changes.
  - A listener is no longer called twice for the same entry when a read and a write happen before the next microtask.
  - A listener removed during a notification is no longer called in that notification.
  - A listener or `compare` that throws no longer stops other listeners or keeps a key from being evicted. The error is reported instead.
  - A `compare` that throws while a fetch settles no longer leaves `isValidating` stuck. The fetched data is stored.
  - A write made by a listener is no longer overwritten when a pending `setResult` settles.

  #### Events and polling
  - Event listeners and polling are set up and removed per store. Before, stores that shared a key could leave listeners running after every subscriber left, or never set them up when a global subscriber came first.
  - Events, polling and `trigger` fetch with the arguments of the newest active subscriber, instead of the first one ever.
  - Event and polling options are skipped when their events are missing, such as in React Native, instead of throwing.
  - `refreshWhenHidden`, `refreshWhenBlurred` and `refreshWhenOffline` start polling right away when the page is already in that state.
  - Several polling states share one interval, and a `refreshInterval` of `0` or less does not poll.
  - Polling runs all the time when none of the chosen `refreshWhen*` states can be detected.
  - A page with an element whose id is `Deno` is no longer treated as a server.

  #### React and Preact
  - The hooks compare cache keys instead of argument objects, and ignore later `initialData` changes. `initialData: []` or object arguments no longer loop forever.
  - The hooks use the newest arguments when arguments change but the key does not.
  - A render retried after suspending gets the data it waited for, even when it has already expired.
  - A `mutate` ends suspense for a component waiting on its first fetch.
  - With `suspense`, a failure that is no longer fresh is fetched again during render, so resetting an error boundary can recover.
  - A new key no longer shows or caches the previous key's `initialData`.
  - A hook that mounts later no longer overwrites a running refetch with old server data.
  - The React hook renders what the server rendered during hydration, so a filled client cache no longer causes a hydration mismatch.
  - Hydrating suspended content no longer fetches outside the cache.
  - Finishing a suspended transition no longer logs an error or shows outdated data.

  #### Solid
  - The hooks read the new result when their arguments change.
  - The hooks keep their subscription, polling and event listeners when arguments change but the key does not.
  - The hooks no longer show data for a key they stopped watching.
  - Store reads no longer track signals.
  - `useSWRStore` no longer shows the `Suspense` fallback again when the cache changes to settled data.
  - A `mutate` ends suspense for a component waiting on its first fetch.
  - `useSWRStore` fetches on the server when `initialData` is passed as `undefined`.
  - `useSWRStore` no longer fetches again on the client after hydrating server data, even when another reader of the key started a fetch first.
  - Hydration with `initialData` but no `hydrate` no longer writes the placeholder to the cache.
  - A resource that failed on the server now fetches on the client.
  - A new key no longer shows or caches the previous key's `initialData`.
