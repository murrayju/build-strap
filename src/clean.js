// @flow
import { cleanDir } from './fs';

/**
 * Cleans up the build output directories.
 */
export async function clean(
  globs: string[] = ['dist/*', 'out/*', 'build/*'],
): Promise<void> {
  await Promise.all(
    globs.map((glob) =>
      cleanDir(glob, {
        nosort: true,
        dot: true,
        ignore: ['.git', '.hg'],
      }),
    ),
  );
}
