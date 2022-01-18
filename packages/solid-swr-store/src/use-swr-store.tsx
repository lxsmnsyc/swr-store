import { createResource, Resource } from 'solid-js';
import { SWRStore } from 'swr-store';

interface UseSWRStoreOptions<T> {
  initialData?: T;
  shouldRevalidate?: boolean;
}

function useSWRStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: () => P,
  options: UseSWRStoreOptions<T>,
): Resource<T | undefined> {
  const [resource] = createResource(
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

  return resource as Resource<T | undefined>;
}

export default useSWRStore;
