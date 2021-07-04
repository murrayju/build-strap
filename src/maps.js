// @flow
// Util functions for using objects as maps and preserving type information

/**
 * An object with arbitrary keys, where every key's value is of the same type.
 */
export type ObjMap<V, K: string = string> = {
  +[K]: V,
};
// Alias for above, generics in opposite order (for backwards compat)
export type MapObj<K, V> = ObjMap<V, K>;

/**
 * Given an input object, return an array of the keys.
 * This is a wrapper around the standard `Object.keys` that preserves type information.
 * @param {ObjMap} obj the input object
 * @returns {Array} an array of keys. These will always be strings, but flow may assign
 * a more specific type when possible
 */
export const keys = <V, K: string = string>(obj?: ?ObjMap<V, K>): K[] =>
  (Object.keys(obj || {}): any);

/**
 * Given an input object, return an array of the values.
 * This is a wrapper around the standard `Object.values` that preserves type information.
 * @param {ObjMap} obj the input object
 * @returns {Array} an array of values
 */
export const values = <V, K: string = string>(obj?: ?ObjMap<V, K>): V[] =>
  (Object.values(obj || {}): any);

/**
 * Given a `ObjMap`, return an array of the entries.
 * This is a wrapper around the standard `Object.entries` that preserves type information.
 * It assumes an object with homogenous values.
 * @param {ObjMap} obj the input object
 * @returns {Array} an array of entry [key, value] tuples
 */
export const entries = <V, K: string = string>(obj?: ?ObjMap<V, K>): [K, V][] =>
  (Object.entries(obj || {}): any);

/**
 * Given a `ObjMap`, iterate over each entry and run it through the given `map` function.
 * @param {ObjMap} obj the input object
 * @param {Function} map the mapping operation
 * @returns {ObjMap} a new object
 */
export const mapValues = <V, K: string, R>(
  obj?: ?ObjMap<V, K>,
  map: (V, K, ObjMap<V, K>) => R,
): ObjMap<R, K> =>
  entries(obj).reduce(
    (acc, [k, v]) =>
      Object.assign(acc, {
        [k]: map(v, k, obj || {}),
      }),
    {},
  );

/**
 * Given a `ObjMap`, iterate over each entry and run it through the given async `map` function.
 * The promise returned by the `map` is awaited, such that the resulting `ObjMap` values are
 * the result of the resolved promise.
 * @param {ObjMap} obj the input object
 * @param {Function} map the async mapping operation
 * @returns {Promise} a promise for a new object
 */
export const mapValuesAsync = async <V, K: string, R>(
  obj?: ?ObjMap<V, K>,
  map: (V, K, ObjMap<V, K>) => Promise<R>,
): Promise<ObjMap<R, K>> =>
  entries(obj).reduce(
    async (acc, [k, v]) =>
      Object.assign(await acc, {
        [k]: await map(v, k, obj || {}),
      }),
    {},
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
export const filterKeys = <V, K: string = string>(
  obj?: ?ObjMap<V, K>,
  filter?: (V, K, ObjMap<V, K>) => boolean = (v) => v != null,
): ObjMap<V, K> =>
  entries(obj).reduce(
    (acc, [k, v]) =>
      filter(v, k, obj || {})
        ? Object.assign(acc, {
            [k]: v,
          })
        : acc,
    {},
  );

/**
 * Given an object, removes any top level keys with a nullish value.
 * The type system should preserve the incoming object type, with all such keys typed as `empty`.
 * @param {Object} obj the input object
 * @returns {Object} a new object, a subset of the input
 */
export const filterNullish = <T: { ... }>(
  obj: T,
): $ObjMap<T, <V>(V) => $NonMaybeType<V>> => filterKeys(obj);
