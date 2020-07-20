// @flow
import { cleanDir } from './fs';
import { getPaths } from './paths';

/**
 * Cleans up the build output directories.
 */
export async function clean(globs?: string[]) {
  const { dist, out } = getPaths();
  const theGlobs = globs || [`${dist}/*`, `${out}/*`];
  return Promise.all(
    theGlobs.map((glob) =>
      cleanDir(glob, {
        nosort: true,
        dot: true,
        ignore: ['.git', '.hg'],
      }),
    ),
  );
}
