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
import { dequal } from 'dequal/lite';
import {
  getMutation,
  MutationListener,
  MutationResult,
  setMutation,
  subscribeMutation,
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
  compare: (a: T, b: T) => boolean = dequal,
): void {
  setRevalidation(key, shouldRevalidate);

  const current = getMutation<T>(key);

  if (
    current
    && current.result.status === 'success' && data.status === 'success'
    && compare(current.result.data, data.data)
  ) {
    current.timestamp = Date.now();
    return;
  }

  setMutation(key, {
    result: data,
    timestamp: Date.now(),
    isValidating: false,
  });
}

export function subscribe<T>(
  key: string,
  listener: MutationListener<T>,
): () => void {
  const wrappedListener: MutationListener<T> = (value) => {
    listener(value);
  };
  return subscribeMutation(key, wrappedListener);
}
