// @flow
import path from 'path';
import {
  getPkg,
  getVersion,
  writeFile,
  copyFile,
  makeDir,
  copySrc,
  copyDir,
  getPaths,
} from '../src/index';

/**
 * Copies everything to the dist folder that we want to publish
 */
export default async function copy() {
  const { dist } = getPaths();
  await makeDir(dist);
  await copySrc();
  const version = await getVersion();
  const {
    name,
    dependencies = {},
    peerDependencies = {},
    engines = {},
  } = getPkg();
  await Promise.all([
    // Support for flow annotation in published libraries
    copyDir('./src', dist, '**/*.js', null, (n) => `${n}.flow`),
    copyDir('./src', dist, '**/!(*.js)'),
    writeFile(
      path.join(dist, 'package.json'),
      JSON.stringify(
        {
          name,
          version: version.npm,
          main: `index.js`,
          dependencies,
          peerDependencies,
          engines,
        },
        null,
        2,
      ),
    ),
    Promise.all(
      ['LICENSE', 'README.md'].map((f) => copyFile(f, path.join(dist, f))),
    ),
  ]);
}
