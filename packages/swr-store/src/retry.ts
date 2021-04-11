interface RetryOptions {
  count?: number;
  interval?: number;
}

export default function retry<T>(supplier: () => Promise<T>, options: RetryOptions): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let count = 0;

    const attempt = () => {
      supplier().then(resolve).catch((err) => {
        if (typeof options.count === 'number' && count > options.count) {
          reject(err);
        } else {
          setTimeout(() => {
            count += 1;

            attempt();
          }, options.interval);
        }
      });
    };

    attempt();
  });
}
