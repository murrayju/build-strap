import fs from 'fs-extra';

import {
  assertReleaseCommitIsOnMainBranch,
  assertReleaseTagMatchesPackageVersion,
  buildLog,
  getVersion,
  npmPublish,
  run,
} from '../src/index.js';

import doPackage from './package.js';

/**
 * Publish to npm. Release versions are only published when the commit being
 * built carries a semver tag and lives on the main branch.
 */
export default async function runPublish() {
  const publishPath = await run(doPackage);

  const version = await getVersion();
  if (version.isRelease) {
    await assertReleaseTagMatchesPackageVersion();
    await assertReleaseCommitIsOnMainBranch();
  }
  const isLocalBuild = parseInt(version.build, 10) === 0;
  const doPublish = process.argv.includes('--force-publish') || !isLocalBuild;
  if (!doPublish) {
    buildLog(
      'Ignoring publish for local build (build number is 0). Use --force-publish to override.',
    );
    return;
  }

  await fs.copyFile('./dist/package.json', './out/package.json');
  await npmPublish({ provenance: true, publishPath });
}
