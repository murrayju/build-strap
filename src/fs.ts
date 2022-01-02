import fs from 'fs-extra';
import glob from 'glob';
import path from 'path';
import rimraf from 'rimraf';

export const readDir = async (
  pattern: string,
  options?: glob.IOptions,
): Promise<string[]> =>
  new Promise((resolve, reject) => {
    glob(pattern, options || {}, (err: Error | null, result: string[]) =>
      err ? reject(err) : resolve(result),
    );
  });

export const moveDir = async (
  source: string,
  target: string,
): Promise<void> => {
  const dirs = await readDir('**/*.*', {
    cwd: source,
    dot: true,
    nosort: true,
  });
  await Promise.all(
    dirs.map(async (dir) => {
      const from = path.resolve(source, dir);
      const to = path.resolve(target, dir);
      await fs.ensureDir(path.dirname(to));
      await fs.rename(from, to);
    }),
  );
};

export const copyDir = async (
  source: string,
  target: string,
  fileGlob = '**/*.*',
  globOptions: null | glob.IOptions = null,
  renameFn: (name: string) => string = (n) => n,
): Promise<void> => {
  const paths = await readDir(fileGlob, {
    cwd: source,
    dot: true,
    nodir: true,
    nosort: true,
    ...globOptions,
  });
  await Promise.all(
    paths.map(async (p) => {
      const from = path.resolve(source, p);
      const to = path.resolve(target, renameFn(p));
      await fs.ensureDir(path.dirname(to));
      await fs.copyFile(from, to);
    }),
  );
};

export const cleanDir = async (
  pattern: string,
  globOptions?: glob.IOptions | false,
): Promise<void> =>
  new Promise((resolve, reject) => {
    rimraf(pattern, { glob: globOptions }, (err?: Error | null) =>
      err ? reject(err) : resolve(),
    );
  });
