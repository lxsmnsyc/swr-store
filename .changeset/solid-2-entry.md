---
'swr-store': minor
---

Add the `swr-store/solid2` entry point for Solid 2.0, with `useSWRStore` and `useSWRStoreSuspenseless`. `useSWRStore` returns an async accessor that waits under `<Loading>` and sends failures to `<Errored>`. `swr-store/solid` stays on Solid 1.x, and the `solid-js` peer dependency now accepts `^1.6 || ^2.0.0`.
