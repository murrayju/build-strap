// @flow
import fs from 'fs-extra';
import path from 'path';
import glob from 'glob';
import rimraf from 'rimraf';

export const readFile = async (
  file: string,
  options: string | Object = 'utf8',
) => fs.readFile(file, options);

export const writeFile = async (
  file: string,
  data: string | Buffer,
  options?: string | Object,
) => fs.writeFile(file, data, options);

export const renameFile = async (source: string, target: string) =>
  fs.rename(source, target);

export const copyFile = async (source: string, target: string) =>
  fs.copyFile(source, target);

export const readDir = async (pattern: string, options?: Object) =>
  new Promise((resolve, reject) =>
    glob(pattern, options, (err, result) =>
      err ? reject(err) : resolve(result),
    ),
  );

export const makeDir = async (name: string) => fs.ensureDir(name);

export const moveDir = async (source: string, target: string) => {
  const dirs = await readDir('**/*.*', {
    cwd: source,
    nosort: true,
    dot: true,
  });
  await Promise.all(
    dirs.map(async (dir) => {
      const from = path.resolve(source, dir);
      const to = path.resolve(target, dir);
      await makeDir(path.dirname(to));
      await renameFile(from, to);
    }),
  );
};

export const copyDir = async (
  source: string,
  target: string,
  fileGlob: string = '**/*.*',
  globOptions?: ?Object = null,
  renameFn: (name: string) => string = (n) => n,
) => {
  const paths = await readDir(fileGlob, {
    cwd: source,
    nosort: true,
    nodir: true,
    dot: true,
    ...globOptions,
  });
  await Promise.all(
    paths.map(async (p) => {
      const from = path.resolve(source, p);
      const to = path.resolve(target, renameFn(p));
      await makeDir(path.dirname(to));
      await copyFile(from, to);
    }),
  );
};

export const cleanDir = async (pattern: string, options?: Object) =>
  new Promise((resolve, reject) =>
    rimraf(pattern, { glob: options }, (err, result) =>
      err ? reject(err) : resolve(result),
    ),
  );
