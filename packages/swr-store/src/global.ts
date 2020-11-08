import {
  addMutationListener,
  MutationListener,
  MutationResult,
  removeMutationListener,
  setMutation,
} from './cache/mutation-cache';
import {
  setRevalidation,
} from './cache/revalidation-cache';

export function trigger(
  key: string,
  shouldRevalidate = true,
): void {
  setRevalidation(key, shouldRevalidate);
}

export function mutate<T>(
  key: string,
  data: MutationResult<T>,
  shouldRevalidate = true,
): void {
  setMutation(key, {
    result: {
      ...data,
    },
    timestamp: Date.now(),
  });
  setRevalidation(key, shouldRevalidate);
}

export function subscribe<T>(
  key: string,
  listener: MutationListener<T>,
): () => void {
  const wrappedListener: MutationListener<T> = (value) => {
    listener({
      ...value,
    });
  };
  addMutationListener(key, wrappedListener);
  return () => {
    removeMutationListener(key, wrappedListener);
  };
}
