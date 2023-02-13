import {
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  Resource,
} from 'solid-js';
import { MutationResult, SWRStore } from 'swr-store';

export interface UseSWRStoreOptions<T> {
  initialData?: T;
  shouldRevalidate?: boolean;
}

export function useSWRStoreSuspenseless<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: () => P,
  options: UseSWRStoreOptions<T>,
): () => MutationResult<T> {
  const [result, setResult] = createSignal(store.get(args(), {
    shouldRevalidate: options.shouldRevalidate,
    initialData: options.initialData,
  }));

  createEffect(() => {
    const currentArgs = args();
    onCleanup(store.subscribe(currentArgs, () => {
      setResult(() => store.get(currentArgs, {
        shouldRevalidate: options.shouldRevalidate,
      }));
    }));
  });

  return result;
}

export function useSWRStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: () => P,
  options: UseSWRStoreOptions<T>,
): Resource<T | undefined> {
  const suspenseless = useSWRStoreSuspenseless(store, args, options);
  const [resource] = createResource(
    suspenseless,
    async (result): Promise<T> => {
      if (result.status === 'failure') {
        throw result.data;
      }
      return result.data;
    },
    {
      initialValue: options.initialData,
    },
  );
  return resource as Resource<T | undefined>;
}
