import React, {
  createContext,
  Dispatch,
  FC,
  SetStateAction,
  Suspense,
  useContext,
  useRef,
  useState,
} from 'react';
import { createSWRStore } from 'swr-store';
import { SWRStoreRoot, useSWRStore } from 'react-swr-store';

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

const Breed = createContext<[string, Dispatch<SetStateAction<string>>]>(
  ['shiba', () => { /* */ }],
);

function DogImage(): JSX.Element {
  const [state] = useContext(Breed);

  const data = useSWRStore(dogAPI, [state], {
    suspense: true,
  });

  return <img src={data.message} alt={data.message} />;
}

function Trigger(): JSX.Element {
  const [state] = useContext(Breed);

  return (
    <button
      type="button"
      onClick={() => {
        dogAPI.trigger([state]);
      }}
    >
      Trigger
    </button>
  );
}

function SetBreed(): JSX.Element {
  const [state, setState] = useContext(Breed);

  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (inputRef.current) {
          setState(inputRef.current.value);
        }
      }}
    >
      <button type="submit">Set Breed</button>
      <input
        type="text"
        name="breed"
        ref={inputRef}
        defaultValue={state}
      />
    </form>
  );
}

const BreedContext: FC = ({ children }) => {
  const state = useState('shiba');

  return (
    <Breed.Provider value={state}>
      {children}
    </Breed.Provider>
  );
};

export default function App(): JSX.Element {
  return (
    <SWRStoreRoot>
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
    </SWRStoreRoot>
  );
}
