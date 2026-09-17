import type { ReactNode } from 'react';
import { Suspense, useState } from 'react';
import { createSWRStore } from 'swr-store';
import { useSWRStore } from 'swr-store/react';

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

interface BreedProps {
  breed: string;
}

function DogImage(props: BreedProps): ReactNode {
  const data = useSWRStore(dogAPI, [props.breed], {
    suspense: true,
  });

  return <img src={data.message} alt={data.message} />;
}

function Trigger(props: BreedProps): ReactNode {
  return (
    <button
      type="button"
      onClick={() => {
        dogAPI.trigger([props.breed]);
      }}
    >
      Trigger
    </button>
  );
}

interface SetBreedProps extends BreedProps {
  onChange: (breed: string) => void;
}

function SetBreed(props: SetBreedProps): ReactNode {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const breed = new FormData(event.currentTarget).get('breed');
        if (typeof breed === 'string') {
          props.onChange(breed);
        }
      }}
    >
      <button type="submit">Set Breed</button>
      <input type="text" name="breed" defaultValue={props.breed} />
    </form>
  );
}

export default function App(): ReactNode {
  const [breed, setBreed] = useState('shiba');

  return (
    <>
      <Trigger breed={breed} />
      <SetBreed breed={breed} onChange={setBreed} />
      <p>Pressing the Trigger button revalidates the image below.</p>
      <div>
        <Suspense fallback={<h1>Loading...</h1>}>
          <DogImage breed={breed} />
        </Suspense>
        <p>
          Image above will automatically update when the page gets re-focused or network goes back
          online.
        </p>
        <p>Image response has a fresh age of 2 seconds and a stale age of 30 seconds.</p>
      </div>
    </>
  );
}
