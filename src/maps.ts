/**
 * Given a `ObjMap`, iterate over each entry and run it through the given `map` function.
 * @param {ObjMap} obj the input object
 * @param {Function} map the mapping operation
 * @returns {ObjMap} a new object
 */
export const mapValues = <K extends string, V, R>(
  obj: null | undefined | Record<K, V>,
  map: (value: V, key: K, map: Record<K, V>) => R,
): Record<K, R> =>
  Object.entries<V>(obj ?? {}).reduce(
    (acc, [k, v]) =>
      Object.assign(acc, {
        [k]: map(v, k as K, (obj ?? {}) as Record<K, V>),
      }),
    {} as Record<K, R>,
  );

/**
 * Given a `ObjMap`, iterate over each entry and run it through the given async `map` function.
 * The promise returned by the `map` is awaited, such that the resulting `ObjMap` values are
 * the result of the resolved promise.
 * @param {ObjMap} obj the input object
 * @param {Function} map the async mapping operation
 * @returns {Promise} a promise for a new object
 */
export const mapValuesAsync = async <K extends string, V, R>(
  obj: null | undefined | Record<K, V>,
  map: (value: V, key: K, objMap: Record<K, V>) => Promise<R>,
): Promise<Record<K, R>> =>
  Object.entries<V>(obj ?? {}).reduce(
    async (acc, [k, v]) =>
      Object.assign(await acc, {
        [k]: await map(v, k as K, (obj ?? {}) as Record<K, V>),
      }),
    Promise.resolve({} as Record<K, R>),
  );

/**
 * Given a `ObjMap`, iterate over each entry and run it through the given `filter` function.
 * Any entry for which the `filter` returns `false` is removed from the resulting `ObjMap`.
 * All other entries are left as-is. The resulting output is a subset of the input.
 * If no `filter` is specified, default to filtering out nullish values.
 * @param {ObjMap} obj the input object
 * @param {Function} filter the filter operation
 * @returns {ObjMap} a new object, a subset of the input
 */
export const filterKeys = <V, K extends string = string>(
  obj: null | undefined | Record<K, V>,
  filter: (value: V, key: K, objMap: Record<K, V>) => boolean = (v) =>
    v != null,
): Partial<Record<K, V>> =>
  Object.entries<V>(obj ?? {}).reduce(
    (acc, [k, v]) =>
      filter(v, k as K, (obj ?? {}) as Record<K, V>)
        ? Object.assign(acc, {
            [k]: v,
          })
        : acc,
    {} as Partial<Record<K, V>>,
  );

/**
 * Given an object, removes any top level keys with a nullish value.
 * The type system should preserve the incoming object type, with all such keys typed as `empty`.
 * @param {Object} obj the input object
 * @returns {Object} a new object, a subset of the input
 */
export const filterNullish = <T>(
  obj: Record<string, T>,
): Record<string, Exclude<T, null | undefined>> => filterKeys(obj) as any;
