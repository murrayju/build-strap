// @flow
import fs from 'fs-extra';
import {
  dockerRmi,
  getUntaggedDockerIds,
  getDockerTags,
  dockerImages,
} from '../src/index';
import { getBuildImage } from './docker';
import type { DockerImage, DockerImageFilter } from '../src/index';

// Publish build artifacts to artifactory, run in docker image
export default async function dockerCleanup(
  purgeAll: boolean = process.argv.includes('--purge-all'),
  purgeOld: boolean = process.argv.includes('--purge-old'),
) {
  await Promise.all(
    ['./latest.build.tag', './latest.build.id'].map(async (f) =>
      fs.ensureFile(f),
    ),
  );
  const tag = (await fs.readFile('./latest.build.tag')).toString();

  const id = (await fs.readFile('./latest.build.id')).toString();

  // We only match images without a latest* tag, and more than an hour old
  const filterLatest: DockerImageFilter = (m: DockerImage) =>
    purgeAll || !m.tag.match(/^latest(-\w+)?$/);
  const filterOld: DockerImageFilter = (m: DockerImage) =>
    purgeAll || (filterLatest(m) && m.created < Date.now() - 1000 * 60 * 60);

  await dockerRmi([
    // unique tags for this build
    ...(tag ? [await getBuildImage(tag)] : []),

    // all other tags for this image (except latest)
    ...(id ? await getDockerTags(id, undefined, true, filterLatest) : []),

    // images in this repo without a tag
    ...(await getUntaggedDockerIds(undefined, filterOld)),

    // images with no repo and no tag
    ...(
      await dockerImages(
        null,
        (m) => m.repository === '<none>' && m.tag === '<none>' && filterOld(m),
      )
    ).map((m) => m.id),

    // any leftover tags from prior builds (only if purgeAll or purgeOld)
    ...(purgeAll || purgeOld
      ? await getDockerTags(null, undefined, true, filterOld)
      : []),
  ]);
  await Promise.all(
    ['./latest.build.tag', './latest.build.id'].map(async (f) => fs.remove(f)),
  );
}
