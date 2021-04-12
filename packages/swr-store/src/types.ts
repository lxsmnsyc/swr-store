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
import {
  MutationListener,
  MutationResult,
} from './cache/mutation-cache';

export type SWRCompare<T> = (a: T, b: T) => boolean;

export type SWRTrigger<P extends any[] = []> =
  (args: P, shouldRevalidate?: boolean) => void;

export type SWRMutate<T, P extends any[] = []> =
  (args: P, data: MutationResult<T>, shouldRevalidate?: boolean, compare?: SWRCompare<T>) => void;

export interface SWRGetOptions<T> {
  shouldRevalidate?: boolean;
  initialData?: T;
  hydrate?: boolean;
}

export type SWRGet<T, P extends any[] = []> =
  (args: P, options?: SWRGetOptions<T>) => MutationResult<T>;

export type SWRSubscribe<T, P extends any[] = []> =
  (args: P, listener: MutationListener<T>) => () => void;

export interface SWRStoreBaseOptions<T, P extends any[] = []> {
  get: (...args: P) => Promise<T>;
  initialData?: T;
  refreshInterval?: number;
  maxRetryCount?: number;
}

export interface SWRStoreExtendedOptions<T, P extends any[] = []> {
  key: (...args: P) => string;

  revalidateOnFocus: boolean;
  revalidateOnVisibility: boolean;
  revalidateOnNetwork: boolean;

  refreshWhenOffline: boolean;
  refreshWhenHidden: boolean;
  refreshWhenBlurred: boolean;

  freshAge: number;
  staleAge: number;

  compare: SWRCompare<T>;

  maxRetryInterval: number;
}

export type SWRStorePartialOptions<T, P extends any[] = []> =
  Partial<SWRStoreExtendedOptions<T, P>>;

export interface SWRStoreOptions<T, P extends any[] = []>
  extends SWRStorePartialOptions<T, P>, SWRStoreBaseOptions<T, P> {
}

export interface SWRFullOptions<T, P extends any[] = []>
  extends SWRStoreExtendedOptions<T, P>, SWRStoreBaseOptions<T, P> {
}

export interface SWRStore<T, P extends any[] = []> {
  id: string;
  trigger: SWRTrigger<P>;
  mutate: SWRMutate<T, P>;
  get: SWRGet<T, P>;
  subscribe: SWRSubscribe<T, P>;
}
