# preact-swr-store

> Preact bindings for `swr-store`

[![NPM](https://img.shields.io/npm/v/preact-swr-store.svg)](https://www.npmjs.com/package/preact-swr-store) [![JavaScript Style Guide](https://badgen.net/badge/code%20style/airbnb/ff5a5f?icon=airbnb)](https://github.com/airbnb/javascript)[![Open in CodeSandbox](https://img.shields.io/badge/Open%20in-CodeSandbox-blue?style=flat-square&logo=codesandbox)](https://codesandbox.io/s/github/LXSMNSYC/swr-store/tree/main/examples/preact-swr-store)

## Install

```bash
npm install --save swr-store preact-swr-store
```

```bash
yarn add swr-store preact-swr-store
```

## Usage

```tsx
import { Suspense } from 'preact';
import { createSWRStore } from 'swr-store';
import { useSWRStore, SWRStoreRoot } from 'preact-swr-store';

const API = 'https://dog.ceo/api/breed/';
const API_SUFFIX = '/images/random';

interface APIResult {
  message: string;
  status: string;
}

const dogAPI = createSWRStore<APIResult, [string]>({
  key: (breed: string) => breed,
  get: async (breed: string) => {
    const response = await fetch(`${API}${breed}${API_SUFFIX}`);
    return (await response.json()) as APIResult;
  },
  revalidateOnFocus: true,
  revalidateOnNetwork: true,
});

function DogImage(): JSX.Element {
  const data = useSWRStore(dogAPI, ['shiba'], {
    suspense: true,
  });

  return <img src={data.message} alt={data.message} />;
}

function Trigger(): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => {
        dogAPI.trigger(['shiba']);
      }}
    >
      Trigger
    </button>
  );
}

export default function App(): JSX.Element {
  return (
    <SWRStoreRoot>
      <Trigger />
      <div>
        <Suspense fallback={<h1>Loading...</h1>}>
          <DogImage />
        </Suspense>
      </div>
    </SWRStoreRoot>
  );
}
```

## API

### `<SWRStoreRoot>`

Must be located at the root of the app/tree.

### `useSWRStore(store, args, options)`

Subscribes to an SWR store, passing `args`, which are received by the corresponding store for data-fetching and cache updates.

`options` has the following properties:

- `suspense`: When `true`, suspends the component when receiving the result, if the result status is `'pending'` until the result resolves,where `useSWRStore` returns the resolved data. Otherwise, `useSWRStore` returns the result. Defaults to `false`.
- `initialData`: Allows lazy hydration when reading the store. If the store does not have cache, `initialData` hydrates the cache and attempts a revalidation. If no `initialData` is provided, defaults to store's `options.initialData`.
- `shouldRevalidate`: If `true`, goes through the revalidation process when reading through the cache. Defaults to `true`.

## License

MIT © [lxsmnsyc](https://github.com/lxsmnsyc)
