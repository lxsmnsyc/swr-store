import { dequal } from 'dequal/lite';
import {
  addMutationListener,
  getMutation,
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
  compare = dequal,
): void {
  setRevalidation(key, shouldRevalidate);

  const current = getMutation<T>(key);

  if (
    current
    && current.result.status === 'success' && data.status === 'success'
    && compare(current.result.data, data.data)
  ) {
    return;
  }

  setMutation(key, {
    result: {
      ...data,
    },
    timestamp: Date.now(),
  });
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
