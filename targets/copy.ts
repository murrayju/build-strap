import fs from 'fs-extra';
import path from 'path';

import { copyDir, getPkg, getVersion } from '../src/index.js';

/**
 * Copies everything to the dist folder that we want to publish
 */
export default async function copy() {
  await fs.ensureDir('./dist');
  await copyDir('./build/src', './dist/src');
  const version = await getVersion();
  /* eslint-disable @typescript-eslint/no-unused-vars */
  const { buildStrap, devDependencies, devEngines, scripts, ...rest } =
    getPkg();
  /* eslint-enable @typescript-eslint/no-unused-vars */
  await Promise.all([
    fs.writeFile(
      './dist/package.json',
      JSON.stringify(
        {
          ...rest,
          main: './src/index.js',
          types: './src/index.d.ts',
          version: version.npm,
        },
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
