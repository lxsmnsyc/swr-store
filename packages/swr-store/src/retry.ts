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
interface RetryOptions {
  count?: number;
  interval: number;
}

interface Resolvable<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: any) => void;
}

export interface Retry<T> {
  resolvable: Resolvable<T>;
  cancel: () => void;
}

function createResolvable<T>(): Resolvable<T> {
  let resolve: Resolvable<T>['resolve'] = () => {
    //
  };
  let reject: Resolvable<T>['reject'] = () => {
    //
  };

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

export default function retry<T>(supplier: () => Promise<T>, options: RetryOptions): Retry<T> {
  let alive = true;
  let schedule: number;

  const resolvable = createResolvable<T>();

  const backoff = (timeout = 10, count = 0) => {
    const handle = (reason: any) => {
      if (!alive || (typeof options.count === 'number' && options.count <= count)) {
        resolvable.reject(reason);
      } else {
        schedule = window.setTimeout(() => {
          backoff(Math.max(10, Math.min(options.interval, timeout * 2)), count + 1);
        }, timeout);
      }
    };

    try {
      supplier().then(resolvable.resolve, handle);
    } catch (reason) {
      handle(reason);
    }
  };

  backoff();

  return {
    resolvable,
    cancel: () => {
      if (schedule) {
        clearTimeout(schedule);
      }
      alive = false;
    },
  };
}
