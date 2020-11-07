export default class NoServerFetchError extends Error {
  constructor() {
    super(`
Attempt to perform fetching on initial process or revalidation process.
SWR stores may only fetch on client-side.

To prevent this error, simply provide a value for 'options.initialData'.
`);
  }
}
