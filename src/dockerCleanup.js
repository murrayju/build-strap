// @flow
import uniq from 'lodash/uniq';
import {
  dockerImages,
  dockerRmi,
  getUntaggedDockerIds,
  getDockerTags,
  getDockerRepo,
} from './docker';
import type { DockerImage, DockerImageFilter } from './docker';
import { dockerContainerLs } from './docker.container';
import { buildLog } from './run';

// flattens arrays of promises and/or promises for arrays
// into a single array of (awaited) values
const flatten = async (input) => {
  const result = await input;
  return Array.isArray(result)
    ? [].concat(...(await Promise.all(result.map(flatten))))
    : result;
};

type CommonDockerCleanupOptions = {|
  /** print matched items to console instead of deleting */
  dryRun?: boolean,
|};

type DockerContainerCleanupOptions = {|
  ...CommonDockerCleanupOptions,
|};

/**
 * Purge stopped containers
 */
export const dockerContainerCleanup = async ({
  dryRun = process.argv.includes('--dry-run'),
}: DockerContainerCleanupOptions = {}) => {
  const toClean = await dockerContainerLs({
    all: true,
    filter: (c) => c.exited,
  });
  if (dryRun) {
    buildLog(
      `Containers to delete (dry run):\n  ${toClean
        .map((c) => c.id)
        .join('\n  ')}`,
    );
  } else {
    await Promise.all(toClean.map(async (c) => c.rm(true)));
  }
};

type DockerImageCleanupOptions = {|
  ...CommonDockerCleanupOptions,
  /** Image repositories to clean (defaults to the one configured in package.json) */
  repos?: string[],
  /** Image ids known to be produced by this build */
  buildImageIds?: string[],
  /** Explicit image names/ids to delete unconditionally */
  images?: string[],
  /**
   * ignore default exclusions of :latest* and images < 1hr old
   * this will delete all images in the given repos
   */
  purgeAll?: boolean,
  /**
   * looks for other builds of the same repos
   * this will still exclude :latest* and images < 1hr old
   * useful to clean up after past builds that failed to clean themselves properly
   */
  purgeOld?: boolean,
|};

/**
 * Purge docker images created during build process
 */
export const dockerImageCleanup = async ({
  repos = [getDockerRepo()],
  buildImageIds = [],
  images = [],
  purgeAll = process.argv.includes('--purge-all'),
  purgeOld = !process.argv.includes('--keep-old'),
  dryRun = process.argv.includes('--dry-run'),
}: DockerImageCleanupOptions = {}) => {
  // only match images without a :latest tag
  const filterLatest: DockerImageFilter = (m: DockerImage) =>
    purgeAll || !m.tag.match(/^latest(-\w+)?$/);
  // only match images more than an hour old, AND without a :latest* tag
  const filterOld: DockerImageFilter = (m: DockerImage) =>
    purgeAll || (filterLatest(m) && m.created < Date.now() - 1000 * 60 * 60);

  const uniqueList = uniq([
    // the things that we know were just built by us
    // remove all tags from the given repos with a matching `buildImageIds`, except for :latest*
    ...(await flatten(
      repos.map((r) =>
        buildImageIds.map(async (b) => getDockerTags(b, r, true, filterLatest)),
      ),
    )),

    // unconditionally delete explicitly passed images/ids
    ...images,

    // images in the given `repos` without a tag, older than 1hr
    ...(await flatten(
      repos.map(async (r) => getUntaggedDockerIds(r, filterOld)),
    )),

    // images with no repo and no tag
    ...(
      await dockerImages(
        null,
        (m) => m.repository === '<none>' && m.tag === '<none>',
      )
    ).map((m) => m.id),

    // any leftover tags from prior builds (only if purgeAll or purgeOld)
    ...(purgeAll || purgeOld
      ? await flatten(
          repos.map(async (r) => getDockerTags(null, r, true, filterOld)),
        )
      : []),
  ]);

  if (dryRun) {
    buildLog(`Images to delete (dry run):\n  ${uniqueList.join('\n  ')}`);
  } else {
    await dockerRmi(uniqueList, true);
  }
};

type DockerCleanupOptions = {|
  ...DockerImageCleanupOptions,
  ...DockerContainerCleanupOptions,
|};

/**
 * Purge docker images created during build process
 */
export const dockerCleanup = async ({
  dryRun,
  ...rest
}: DockerCleanupOptions = {}) => {
  await dockerContainerCleanup({ dryRun });
  await dockerImageCleanup({
    dryRun,
    ...rest,
  });
};

export default dockerCleanup;
