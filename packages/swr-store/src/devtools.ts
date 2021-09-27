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
import { addTransformer, stringify, withRecursionTracker } from 'ecmason';

interface ErrorECMASon {
  name: string;
  message: string;
}

if (process.env.NODE_ENV !== 'production') {
  addTransformer<Promise<any>, null>('object', {
    tag: 'PROMISE',
    check: (value): value is Promise<any> => value instanceof Promise,
    serialize: () => null,
    deserialize: () => Promise.resolve(),
  });
  addTransformer<(...args: any[]) => any, string>('primitive', {
    tag: 'FUNCTION',
    check: (v): v is ((...args: any[]) => any) => typeof v === 'function',
    serialize: (v) => `ƒ ${v.name} () { }`,
    deserialize: (v) => {
      const newFunc = () => { /* noop */ };
      newFunc.name = v;
      return newFunc;
    },
  });
  addTransformer('object', withRecursionTracker<Error, ErrorECMASon>({
    tag: 'ERROR',
    check: (v): v is Error => v instanceof Error,
    serialize: (v) => ({
      name: v.name,
      message: v.message,
    }),
    deserialize: (v) => {
      const error = new Error(v.message);
      error.name = v.name;
      return error;
    },
  }));
}

export default function updateData<T>(key: string, data: T): void {
  if (process.env.NODE_ENV !== 'production' && typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('__SWR_STORE__', {
      detail: {
        key,
        data: stringify(data),
      },
    }));
  }
}
