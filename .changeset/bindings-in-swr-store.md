---
'swr-store': major
---

The React, Preact and Solid bindings now ship inside `swr-store`.

- Import them from `swr-store/react`, `swr-store/preact` and `swr-store/solid`. They replace the `react-swr-store`, `preact-swr-store` and `solid-swr-store` packages.
- `react`, `preact` and `solid-js` are optional peer dependencies. Install only the one you use.
- The React binding supports React 18 and 19, and the Preact binding needs Preact 10.11 or later. Both use `useSyncExternalStore` and no longer need `SWRStoreRoot`. The component is still exported but only renders its children.
- The `suspense` option of the React and Preact `useSWRStore` can be left out.
- The Solid hooks now read the new result when their arguments change, and `options` can be left out.
- A failed fetch no longer throws a `window is not defined` error when retrying on the server.
- The package is built with tsdown. ESM and CommonJS builds are still published, but the separate `development` builds are gone.
