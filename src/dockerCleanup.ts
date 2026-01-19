import { uniq } from 'lodash-es';
import moment from 'moment';

import { dockerContainerLs } from './docker.container.js';
import {
  DockerImage,
  DockerImageFilter,
  dockerImages,
  dockerRmi,
  getDockerRepo,
  getDockerTags,
  getUntaggedDockerIds,
} from './docker.js';
import { buildLog } from './run.js';

// flattens arrays of promises and/or promises for arrays
// into a single array of (awaited) values
async function flatten(
  input: Promise<string>[] | Promise<string[]>[] | Promise<string[]>[][],
): Promise<string[]> {
  const result = await input;
  return Array.isArray(result)
    ? ([] as string[]).concat(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(await Promise.all<string[][]>(result.map(flatten as any))),
      )
    : result;
}

interface CommonDockerCleanupOptions {
  /** print matched items to console instead of deleting */
  dryRun?: boolean;
}

/**
 * Purge stopped containers
 */
export const dockerContainerCleanup = async ({
  dryRun = process.argv.includes('--dry-run'),
}: CommonDockerCleanupOptions = {}) => {
  const toClean = await dockerContainerLs({
    all: true,
    filter: (c) => c.exited,
  });
  if (dryRun) {
    if (toClean) {
      buildLog(
        `Containers to delete (dry run):\n  ${toClean
          .map((c) => c.id)
          .join('\n  ')}`,
      );
    } else {
      buildLog('No containers to delete (dry run)');
    }
  } else if (toClean) {
    await Promise.all(toClean.map(async (c) => c.rm(true)));
  }
};

interface DockerImageCleanupOptions extends CommonDockerCleanupOptions {
  /** Image ids known to be produced by this build */
  buildImageIds?: string[];
  /** Explicit image names/ids to delete unconditionally */
  images?: string[];
  /**
   * ignore default exclusions of :latest* and images < 1hr old
   * this will delete all images in the given repos
   */
  purgeAll?: boolean;
  /**
   * looks for other builds of the same repos
   * this will still exclude :latest* and images < 1hr old
   * useful to clean up after past builds that failed to clean themselves properly
   */
  purgeOld?: boolean;
  /** Image repositories to clean (defaults to the one configured in package.json) */
  repos?: string[];
}

/**
 * Purge docker images created during build process
 */
export const dockerImageCleanup = async ({
  buildImageIds = [],
  dryRun = process.argv.includes('--dry-run'),
  images = [],
  purgeAll = process.argv.includes('--purge-all'),
  purgeOld = !process.argv.includes('--keep-old'),
  repos = [getDockerRepo()],
}: DockerImageCleanupOptions = {}) => {
  // only match images without a :latest tag
  const filterLatest: DockerImageFilter = (m: DockerImage) =>
    purgeAll || !m.tag.match(/^latest(-\w+)?$/);
  // only match images more than an hour old, AND without a :latest* tag
  const filterOld: DockerImageFilter = (m: DockerImage) =>
    purgeAll ||
    (filterLatest(m) && moment().subtract(1, 'h').isAfter(m.created));

  const uniqueList: string[] = uniq([
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
        (m) => m.repository === '<none>' && m.tag === '<none>' && filterOld(m),
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

interface DockerCleanupOptions
  extends DockerImageCleanupOptions, CommonDockerCleanupOptions {}

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
