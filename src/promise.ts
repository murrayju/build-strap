/**
 * This generates a function that, when invoked, will only invoke the producer once.
 * On subsequent calls, the previously produced value will be returned.
 * @param producer a function that produces a promise, will be invoked at most once
 * @returns a function that returns a promise
 */
export const resolveOnce = <T>(
  producer: () => Promise<T>,
): (() => Promise<T>) => {
  let promisedResult: Promise<T> | undefined;
  return async () => {
    if (!promisedResult) {
      promisedResult = producer();
    }
    return promisedResult;
  };
};
