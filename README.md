# swr-store

> Reactive stores for data fetching with the stale-while-revalidate strategy.

[![NPM](https://img.shields.io/npm/v/swr-store.svg)](https://www.npmjs.com/package/swr-store)

A store wraps an async function, caches its results, and refetches in the background when the cache gets old. It works on its own or through the React, Preact and Solid bindings.

See the [package README](https://github.com/lxsmnsyc/swr-store/tree/main/packages/swr-store) for guides and the full API.

## Entry points

| Import             | Peer dependency         | Example                                                                            |
| ------------------ | ----------------------- | ---------------------------------------------------------------------------------- |
| `swr-store`        | None                    |                                                                                    |
| `swr-store/react`  | `react` 18 or 19        | [examples/react](https://github.com/lxsmnsyc/swr-store/tree/main/examples/react)   |
| `swr-store/preact` | `preact` 10.11 or later | [examples/preact](https://github.com/lxsmnsyc/swr-store/tree/main/examples/preact) |
| `swr-store/solid`  | `solid-js` 1.6 or later | [examples/solid](https://github.com/lxsmnsyc/swr-store/tree/main/examples/solid)   |

The framework peer dependencies are optional. Install only the one you use.

The `react-swr-store`, `preact-swr-store` and `solid-swr-store` packages are replaced by these entry points.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm fmt
```

Add a changeset with `pnpm cs:add` for any change that should be released.

## License

MIT © [lxsmnsyc](https://github.com/lxsmnsyc)
