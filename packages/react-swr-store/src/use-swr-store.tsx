/**
 * @license
 * MIT License
 *
 * Copyright (c) 2021 Alexis Munsayac
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 *
 * @author Alexis Munsayac <alexis.munsayac@gmail.com>
 * @copyright Alexis Munsayac 2021
 */
import { useDebugValue } from 'react';
import { SWRStore, MutationResult } from 'swr-store';
import {
  useConditionalMemo,
} from '@lyonph/react-hooks';
import {
  createStoreAdapter,
  StoreAdapter,
  useStoreAdapter,
} from 'react-store-adapter';

function compareArray<T extends any[] = []>(
  prev: T, next: T,
): boolean {
  if (prev === next) {
    return false;
  }
  if (prev.length !== next.length) {
    return true;
  }
  for (let i = 0; i < prev.length; i += 1) {
    if (!Object.is(prev[i], next[i])) {
      return true;
    }
  }
  return false;
}

interface BaseOptions<T> {
  initialData?: T;
  shouldRevalidate?: boolean;
}

interface WithSuspenseOptions<T> extends BaseOptions<T> {
  suspense: true;
}
interface WithoutSuspenseOptions<T> extends BaseOptions<T> {
  suspense: false;
}

export type UseSWRStoreOptions<T> =
  | WithSuspenseOptions<T>
  | WithoutSuspenseOptions<T>;

function useSWRStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: P,
  options?: WithoutSuspenseOptions<T>,
): MutationResult<T>;
function useSWRStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: P,
  options?: WithSuspenseOptions<T>,
): T;
function useSWRStore<T, P extends any[] = []>(
  store: SWRStore<T, P>,
  args: P,
  { suspense, initialData, shouldRevalidate }: UseSWRStoreOptions<T> = {
    suspense: false,
  },
): MutationResult<T> | T {
  const sub = useConditionalMemo(
    (): StoreAdapter<MutationResult<T>> => createStoreAdapter({
      read: () => store.get(args, {
        shouldRevalidate,
        initialData,
      }),
      subscribe: (callback) => store.subscribe(args, callback),
    }),
    [store, initialData, shouldRevalidate, ...args],
    compareArray,
  );

  const value = useStoreAdapter(sub);

  useDebugValue(suspense && value.status === 'success' ? value.data : value);

  if (suspense) {
    if (value.status === 'success') {
      return value.data;
    }
    throw value.data;
  }
  return value;
}

export default useSWRStore;
