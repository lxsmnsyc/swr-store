# react-swr-store

> React bindings for `swr-store`

[![NPM](https://img.shields.io/npm/v/react-swr-store.svg)](https://www.npmjs.com/package/react-swr-store) [![JavaScript Style Guide](https://badgen.net/badge/code%20style/airbnb/ff5a5f?icon=airbnb)](https://github.com/airbnb/javascript)

## Install

```bash
npm install --save swr-store react-swr-store
```

```bash
yarn add swr-store react-swr-store
```

## Usage

```tsx
import React, { Suspense } from 'react';
import { createSWRStore } from 'swr-store';
import useSWRStore from 'react-swr-store';

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
  const data = useSWRStore(dogAPI, ['shiba'], true);

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
    <>
      <Trigger />
      <div>
        <Suspense fallback={<h1>Loading...</h1>}>
          <DogImage />
        </Suspense>
      </div>
    </>
  );
}
```

## API

### `useSWRStore(store, args, suspense = false)`

Subscribes to an SWR store, passing `args`, which are received by the corresponding store for data-fetching and cache updates.

If `suspense` is true, `useSWRStore` suspends the component until the result state is `'success'`, returning the resolved data. Otherwise, `useSWRStore` returns the result directly.

## License

MIT © [lxsmnsyc](https://github.com/lxsmnsyc)
