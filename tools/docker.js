// @flow
import fs from 'fs-extra';
import {
  buildLog,
  getDockerRepo,
  getVersion,
  getUniqueBuildTag,
  getDockerId,
  dockerBuild,
  dockerTagVersion,
} from '../src/index';

export async function getBuildTag(): Promise<string> {
  return `build-${await getUniqueBuildTag()}`;
}

export async function getBuildImage(tag?: string): Promise<string> {
  return `${getDockerRepo()}:${tag || (await getBuildTag())}`;
}

// Build the project using docker
export default async function docker() {
  if (process.argv.includes('--no-docker')) {
    buildLog('Skipping due to --no-docker');
    return;
  }

  // ensure that these files exist, so that we can guarantee to stash them
  await Promise.all(
    ['./latest.build.tag', './latest.build.id'].map(async (f) =>
      fs.ensureFile(f),
    ),
  );

  const { build } = await getVersion();
  const buildTag = await getBuildTag();
  await fs.writeFile('./latest.build.tag', buildTag);
  await dockerBuild(['latest-build', buildTag], [`BUILD_NUMBER=${build}`]);
  const buildId = await getDockerId(buildTag);
  await fs.writeFile('./latest.build.id', buildId);
  await dockerTagVersion(buildId);

  buildLog(`Successfully built docker image: ${buildId}`);
}
