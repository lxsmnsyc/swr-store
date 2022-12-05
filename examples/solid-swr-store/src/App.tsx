import { createSWRStore } from 'swr-store';
import { useSWRStore } from 'solid-swr-store';
import {
  createContext,
  createSignal,
  JSX,
  Show,
  Suspense,
  useContext,
} from 'solid-js';

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
  maxRetryCount: 10,
});

interface BreedContext {
  value: string;
}

const Breed = createContext<BreedContext>({ value: 'shiba' });

function DogImage(): JSX.Element {
  const ctx = useContext(Breed);

  const data = useSWRStore(dogAPI, (): [string] => [ctx.value], {});

  return (
    <Show when={data()} keyed>
      {(value) => <img src={value.message} alt={value.message} />}
    </Show>
  );
}

function Trigger(): JSX.Element {
  const ctx = useContext(Breed);

  return (
    <button
      type="button"
      onClick={() => {
        dogAPI.trigger([ctx.value]);
      }}
    >
      Trigger
    </button>
  );
}

function SetBreed(): JSX.Element {
  const ctx = useContext(Breed);

  let inputRef: HTMLInputElement | undefined;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (inputRef && ctx) {
          ctx.value = inputRef.value;
        }
      }}
    >
      <button type="submit">Set Breed</button>
      <input
        type="text"
        name="breed"
        ref={inputRef}
      />
    </form>
  );
}

function BreedContext(props: { children: JSX.Element}) {
  const [breed, setBreed] = createSignal('shiba');

  return (
    <Breed.Provider
      value={{
        get value() {
          return breed();
        },
        set value(newValue: string) {
          setBreed(() => newValue);
        },
      }}
    >
      {props.children}
    </Breed.Provider>
  );
}

export default function App(): JSX.Element {
  return (
    <BreedContext>
      <Trigger />
      <SetBreed />
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
    </BreedContext>
  );
}
