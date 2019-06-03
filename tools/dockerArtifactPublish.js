// @flow
import fs from 'fs-extra';
import { buildLog, dockerRun } from '../src/index';
import { getBuildImage, getBuildTag } from './docker';

// Publish build artifacts from within docker container
export default async function dockerArtifactPublish(
  envWhitelist?: string[] = ['ARTIFACTORY_CREDS', 'NPM_CREDS', 'BUILD_NUMBER'],
) {
  const tagFromFile = (await fs.readFile('./latest.build.tag')).toString();
  const buildTag = await getBuildTag();
  const tag = tagFromFile || buildTag;
  if (tagFromFile !== buildTag) {
    buildLog(
      `Warning: content of latest.build.tag (${tagFromFile}) was not the current expected value (${buildTag}). Using ${tag}.`,
    );
  }
  await dockerRun(
    [
      '--rm',
      ...Object.keys(process.env)
        .filter(k => envWhitelist.includes(k))
        .reduce(
          (arr, k) => [...arr, '--env', `${k}=${process.env[k] || ''}`],
          [],
        ),
    ],
    await getBuildImage(tag),
    ['publish', '--publish', '--publish-only'],
  );
}
