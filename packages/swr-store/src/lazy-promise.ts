// A promise that calls `start` the first time it is awaited or chained.
// It cannot be an `async` function, because awaiting the returned object
// would call `then` and start the work right away.
// oxlint-disable-next-line typescript/promise-function-async
export default function createLazyPromise<T>(start: () => Promise<T>): Promise<T> {
  let promise: Promise<T> | undefined;
  const get = async (): Promise<T> => {
    promise ??= start();
    return promise;
  };
  return {
    [Symbol.toStringTag]: 'Promise',
    // oxlint-disable-next-line unicorn/no-thenable
    then: async (onFulfilled, onRejected) => get().then(onFulfilled, onRejected),
    catch: async (onRejected) => get().catch(onRejected),
    finally: async (onFinally) => get().finally(onFinally),
  };
}
