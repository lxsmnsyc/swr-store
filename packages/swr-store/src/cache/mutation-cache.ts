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
import updateData from '../devtools';
import {
  addReactiveCacheListener,
  createReactiveCache,
  getReactiveCacheListenerSize,
  ReactiveCacheListener,
  removeReactiveCacheListener,
  setReactiveCacheValue,
} from './reactive-cache';

export interface MutationPending<T> {
  data: Promise<T>;
  status: 'pending';
}
export interface MutationSuccess<T> {
  data: T;
  status: 'success';
}
export interface MutationFailure {
  data: any;
  status: 'failure';
}
export type MutationResult<T> =
  | MutationPending<T>
  | MutationSuccess<T>
  | MutationFailure;

export interface Mutation<T> {
  result: MutationResult<T>;
  timestamp: number;
}

export const MUTATION_CACHE = createReactiveCache<Mutation<any>>();

export type MutationListener<T> = ReactiveCacheListener<Mutation<T>>;

export function addMutationListener<T>(
  key: string,
  listener: MutationListener<T>,
): void {
  addReactiveCacheListener(MUTATION_CACHE, key, listener);
}

export function removeMutationListener<T>(
  key: string,
  listener: MutationListener<T>,
): void {
  removeReactiveCacheListener(MUTATION_CACHE, key, listener);
}

export function setMutation<T>(
  key: string,
  value: Mutation<T>,
): void {
  setReactiveCacheValue(MUTATION_CACHE, key, value);
  updateData(key, 'MUTATION', value);
}

export function getMutation<T>(
  key: string,
): Mutation<T> | undefined {
  return MUTATION_CACHE.cache.get(key)?.value;
}

export function getMutationListenerSize(
  key: string,
): number {
  return getReactiveCacheListenerSize(MUTATION_CACHE, key);
}
