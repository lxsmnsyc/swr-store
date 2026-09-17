declare const reportError: ((error: unknown) => void) | undefined;

// Reports an error from user code without stopping the caller. Browsers log
// it like an uncaught error. Elsewhere it is thrown from a microtask, so it
// still reaches the runtime's uncaught error handling.
export default function reportUserError(error: unknown): void {
  if (typeof reportError === 'function') {
    reportError(error);
    return;
  }
  queueMicrotask(() => {
    throw error;
  });
}
