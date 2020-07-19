// @flow
import fs from 'fs-extra';
import { dockerCleanup } from '../src/index';
import { getBuildImage } from './docker';

// Publish build artifacts to artifactory, run in docker image
export default async function cleanup() {
  await Promise.all(
    ['./latest.build.tag', './latest.build.id'].map(async (f) =>
      fs.ensureFile(f),
    ),
  );
  const tag = (await fs.readFile('./latest.build.tag')).toString();
  const id = (await fs.readFile('./latest.build.id')).toString();

  await dockerCleanup({
    buildImageIds: [id],
    images: tag ? [await getBuildImage(tag)] : [],
  });

  await Promise.all(
    ['./latest.build.tag', './latest.build.id'].map(async (f) => fs.remove(f)),
  );
}
