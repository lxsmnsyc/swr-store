interface RetryOptions {
  count?: number;
  interval: number;
}

export default function retry<T>(supplier: () => Promise<T>, options: RetryOptions): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const backoff = (timeout = 10, count = 0) => {
      supplier().then(resolve).catch((reason) => {
        if (typeof options.count === 'number' && options.count <= count) {
          reject(reason);
        } else {
          setTimeout(() => {
            backoff(Math.max(10, Math.min(options.interval, timeout * 2)), count + 1);
          }, timeout);
        }
      });
    };

    backoff();
  });
}
