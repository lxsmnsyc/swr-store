import {
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  Resource,
} from 'solid-js';
import { MutationResult, SWRStore } from 'swr-store';

interface UseSWRStoreOptions<T> {
  initialData?: T;
  shouldRevalidate?: boolean;
}

export function useSWRStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: () => P,
  options: UseSWRStoreOptions<T>,
): Resource<T | undefined> {
  const [resource, { mutate }] = createResource(
    () => ({
      args: args(),
      options: {
        shouldRevalidate: options.shouldRevalidate,
      },
    }),
    async (params): Promise<T> => {
      const result = store.get(params.args, {
        shouldRevalidate: params.options.shouldRevalidate,
      });
      if (result.status === 'failure') {
        throw result.data;
      }
      return result.data;
    },
    {
      initialValue: options.initialData,
    },
  );

  createEffect(() => {
    const currentArgs = args();
    onCleanup(store.subscribe(currentArgs, () => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      mutate(() => {
        const result = store.get(currentArgs, {
          shouldRevalidate: options.shouldRevalidate,
          initialData: options.initialData,
        });
        if (result.status === 'failure') {
          throw result.data;
        }
        return result.data;
      });
    }));
  });

  return resource as Resource<T | undefined>;
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
        initialData: options.initialData,
      }));
    }));
  });

  return result;
}
