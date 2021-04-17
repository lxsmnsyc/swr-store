import 'preact/debug';
import { Suspense } from 'preact/compat';
import { createSWRStore } from 'swr-store';
import { SWRStoreRoot, useSWRStore } from 'preact-swr-store';

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
    if (response.ok) {
      return (await response.json()) as APIResult;
    }
    throw new Error('Not found');
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
      <p>
        Pressing the Trigger button revalidates the image below.
      </p>
      <div>
        <Suspense fallback={<h1>Loading...</h1>}>
          <DogImage />
        </Suspense>
        <p>
          Image above will automatically update when the page
          gets re-focused or network goes back online.
        </p>
        <p>
          Image response has a fresh age of 2 seconds and a stale age of 30 seconds.
        </p>
      </div>
    </SWRStoreRoot>
  );
}
