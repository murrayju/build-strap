import {
  getPkg,
  getVersion,
  writeFile,
  copyFile,
  makeDir,
  copySrc,
  copyDir,
} from '../src/index';
import paths from './paths';

/**
 * Copies everything to the dist folder that we want to publish
 */
export default async function copy() {
  await makeDir(paths.dist);
  await copySrc(paths.src, paths.distSrc, false);
  const version = await getVersion();
  const pkg = getPkg();
  await Promise.all([
    // Support for flow annotation in published libraries
    copyDir('./src', paths.dist, '**/*.js', null, n => `${n}.flow`),
    copyDir('./src', paths.dist, '**/!(*.js)'),
    writeFile(
      paths.in(paths.dist, 'package.json'),
      JSON.stringify(
        {
          name: pkg.name,
          version: version.npm,
          main: `index.js`,
          dependencies: pkg.dependencies || [],
          peerDependencies: pkg.peerDependencies || [],
          engines: pkg.engines || [],
        },
        null,
        2,
      ),
    ),
    Promise.all(
      ['LICENSE', 'README.md'].map(f => copyFile(f, paths.in(paths.dist, f))),
    ),
  ]);
}
