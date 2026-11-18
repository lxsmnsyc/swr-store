import type { JSX } from '@solidjs/web';
import { Errored, Loading, createSignal } from 'solid-js';
import { createSWRStore } from 'swr-store';
import { useSWRStore } from 'swr-store/solid2';

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

function DogImage(props: BreedProps): JSX.Element {
  const data = useSWRStore(dogAPI, (): [string] => [props.breed]);

  return <img src={data().message} alt={data().message} />;
}

function Trigger(props: BreedProps): JSX.Element {
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

function SetBreed(props: SetBreedProps): JSX.Element {
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
      <input type="text" name="breed" value={props.breed} />
    </form>
  );
}

export default function App(): JSX.Element {
  const [breed, setBreed] = createSignal('shiba');

  return (
    <>
      <Trigger breed={breed()} />
      <SetBreed
        breed={breed()}
        onChange={(value) => {
          setBreed(value);
        }}
      />
      <p>Pressing the Trigger button revalidates the image below.</p>
      <div>
        <Errored fallback={(error) => <h1>{String(error())}</h1>}>
          <Loading fallback={<h1>Loading...</h1>}>
            <DogImage breed={breed()} />
          </Loading>
        </Errored>
        <p>
          Image above will automatically update when the page gets re-focused or network goes back
          online.
        </p>
        <p>Image response has a fresh age of 2 seconds and a stale age of 30 seconds.</p>
      </div>
    </>
  );
}
