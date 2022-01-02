import { cleanDir } from './fs.js';

/**
 * Cleans up the build output directories.
 */
export async function clean(
  globs: string[] = ['dist/*', 'out/*', 'build/*'],
): Promise<void> {
  await Promise.all(
    globs.map((glob) =>
      cleanDir(glob, {
        dot: true,
        ignore: ['.git', '.hg'],
        nosort: true,
      }),
    ),
  );
}
