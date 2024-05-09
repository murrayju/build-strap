import fs from 'fs-extra';
import { glob, GlobOptions, GlobOptionsWithFileTypesUnset } from 'glob';
import path from 'path';
import { rimraf } from 'rimraf';

import { resolveOnce } from './promise.js';
import { buildLog } from './run.js';

export const readDir = async (
  pattern: string,
  options?: GlobOptionsWithFileTypesUnset,
): Promise<string[]> => glob(pattern, options);

export const moveDir = async (
  source: string,
  target: string,
): Promise<void> => {
  const dirs = await readDir('**/*.*', {
    cwd: source,
    dot: true,
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
  globOptions: null | GlobOptionsWithFileTypesUnset = null,
  renameFn: (name: string) => string = (n) => n,
): Promise<void> => {
  const paths = await readDir(fileGlob, {
    cwd: source,
    dot: true,
    nodir: true,
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
  globOptions?: GlobOptions | false,
): Promise<boolean> => rimraf(pattern, { glob: globOptions });

export const producedPathExists = async (
  producer: () => Promise<string>,
): Promise<boolean> => {
  try {
    const result = (await producer()).trim();
    return !!result && fs.pathExists(result);
  } catch {
    return false;
  }
};

export const copyIfMissing = async (src: string, dest: string) => {
  if (!(await fs.pathExists(dest))) {
    buildLog(`${dest} not found, copying...`);
    await fs.ensureDir(path.dirname(dest));
    await fs.copy(src, dest);
  }
};

export type StringGenFn = () => string | Promise<string>;

const resolveStringGen = async (
  content: string | StringGenFn,
): Promise<string> => (typeof content === 'function' ? content() : content);

export const writeIfMissing = async (
  dest: string,
  content: string | StringGenFn,
) => {
  if (!(await fs.pathExists(dest))) {
    buildLog(`${dest} not found, writing...`);
    await fs.ensureDir(path.dirname(dest));
    await fs.writeFile(dest, await resolveStringGen(content));
    return true;
  }
  return false;
};

export const appendIfMissing = async (
  dest: string,
  content: string | StringGenFn,
  testContent?: string | StringGenFn,
) => {
  if (!(await writeIfMissing(dest, content))) {
    const existingContent = await fs.readFile(dest, 'utf8');
    const getContent = resolveOnce(() => resolveStringGen(content));
    if (
      !existingContent.includes(
        await (testContent ? resolveStringGen(testContent) : getContent()),
      )
    ) {
      buildLog(`${dest} not yet updated, appending...`);
      await fs.appendFile(dest, await getContent());
    }
  }
};
