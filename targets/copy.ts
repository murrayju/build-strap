import fs from 'fs-extra';
import path from 'path';

import { copyDir, getPkg, getVersion, PackageJson } from '../src/index.js';

/**
 * Copies everything to the dist folder that we want to publish
 */
export default async function copy() {
  await fs.ensureDir('./dist');
  await copyDir('./build/src', './dist/src');
  const version = await getVersion();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { buildStrap, devDependencies, scripts, ...rest } = getPkg();
  await Promise.all([
    fs.writeFile(
      './dist/package.json',
      JSON.stringify(
        {
          ...rest,
          main: './src/index.js',
          types: './src/index.d.ts',
          version: version.npm,
        } as PackageJson,
        null,
        2,
      ),
    ),
    Promise.all(
      ['LICENSE', 'README.md'].map((f) =>
        fs.copyFile(f, path.join('./dist', f)),
      ),
    ),
  ]);
}
