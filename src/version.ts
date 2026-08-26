import fs from 'fs';

import { gitInfo, gitIsAncestor, gitTagsAtCommit } from './git.js';
import { getCfg, getPkg } from './pkg.js';
import { buildLog } from './run.js';

export function getBuild(): string {
  const arg = process.argv.find((el) => /^--buildNum=\d+$/.test(el));
  return arg?.substring(11) || process.env.BUILD_NUMBER || '0';
}

/**
 * The one long-lived branch of the repository. All work happens on short-lived
 * branches that are merged into it via pull request, and releases are cut by
 * pushing a semver tag to a commit on it.
 */
export function getMainBranch(): string {
  const { mainBranch } = getCfg();
  return mainBranch || 'main';
}

enum RepoType {
  git = 'git',
  hg = 'hg',
  unknown = 'unknown',
}

// Returns a promise (rather than being `async`) because the body is synchronous
// but the exported signature is awaited by callers and must stay thenable.

export function getRepoType(): Promise<RepoType> {
  const { repoType } = getCfg();

  return Promise.resolve(
    (repoType as RepoType) ||
      (fs.existsSync('./.git')
        ? RepoType.git
        : fs.existsSync('./.hg')
          ? RepoType.hg
          : RepoType.unknown),
  );
}

interface RepoInfo {
  // null when building a detached HEAD (e.g. a tag build) and no branch name
  // could be determined from the environment
  branch: null | string;
  revision: string;
}

export async function getRepoInfo(): Promise<RepoInfo> {
  const repoType = await getRepoType();
  if (repoType !== RepoType.git) {
    throw new Error(`Unsupported repo type: ${repoType}`);
  }
  const { branch, revision } = await gitInfo();
  if (!revision) {
    throw new Error('Failed to parse revision from source repo.');
  }
  return { branch, revision };
}

export interface SemverTag {
  major: string;
  minor: string;
  patch: string;
  // pre-release identifiers, e.g. `rc.1` for tag `v1.2.3-rc.1`
  prerelease: null | string;
  // the tag exactly as it exists in the repository, e.g. `v1.2.3`
  tag: string;
  // the semver version encoded by the tag, e.g. `1.2.3`
  version: string;
}

const semverTagRegex =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/**
 * Parse a git tag as a semver release tag. Returns null if the tag is not a
 * semver version tag (an optional leading `v` is allowed).
 */
export function parseSemverTag(tag: string): null | SemverTag {
  const [, major, minor, patch, prerelease] = semverTagRegex.exec(tag) || [];
  if (!major || !minor || !patch) {
    return null;
  }
  return {
    major,
    minor,
    patch,
    prerelease: prerelease || null,
    tag,
    version: `${major}.${minor}.${patch}${prerelease ? `-${prerelease}` : ''}`,
  };
}

/**
 * The semver tag pointing at the commit being built, if any. This is what makes
 * a build a release build: releases are triggered by pushing a semver tag.
 * When multiple semver tags point at the same commit, the highest one wins.
 */
export async function getReleaseTag(): Promise<null | SemverTag> {
  const overrideTag =
    process.argv
      .find((el) => el.startsWith('--releaseTag='))
      ?.substring('--releaseTag='.length) ||
    process.env.RELEASE_TAG ||
    // GitHub Actions sets this for tag builds
    process.env.GITHUB_REF?.match(/^refs\/tags\/(.+)$/)?.[1];
  if (overrideTag) {
    const parsed = parseSemverTag(overrideTag);
    if (!parsed) {
      throw new Error(`\`${overrideTag}\` is not a valid semver release tag.`);
    }
    return parsed;
  }
  if ((await getRepoType()) !== RepoType.git) {
    return null;
  }
  const semverTags = (await gitTagsAtCommit())
    .map(parseSemverTag)
    .filter((t): t is SemverTag => t != null);
  return (
    semverTags.sort((a, b) =>
      a.version.localeCompare(b.version, undefined, { numeric: true }),
    )[semverTags.length - 1] || null
  );
}

/**
 * Verify that the semver release tag agrees with the version in package.json, so
 * that the published artifact always matches its source. Pre-release identifiers
 * on the tag (e.g. `v1.2.3-rc.1` for package version `1.2.3`) are allowed.
 */
export async function assertReleaseTagMatchesPackageVersion(): Promise<void> {
  const releaseTag = await getReleaseTag();
  if (!releaseTag) {
    return;
  }
  const { version: pkgVersion } = getPkg();
  const pkgSemver = parseSemverTag(pkgVersion);
  const tagBaseVersion = `${releaseTag.major}.${releaseTag.minor}.${releaseTag.patch}`;
  const pkgBaseVersion =
    pkgSemver && `${pkgSemver.major}.${pkgSemver.minor}.${pkgSemver.patch}`;
  if (tagBaseVersion !== pkgBaseVersion) {
    throw new Error(
      `Refusing to release: tag \`${releaseTag.tag}\` does not match the version in package.json (\`${pkgVersion}\`).`,
    );
  }
}

/**
 * Verify that the commit being released is contained in the main branch, so that
 * a release can never be cut from an unmerged work branch.
 */
export async function assertReleaseCommitIsOnMainBranch(
  mainBranch: string = getMainBranch(),
): Promise<void> {
  const { revision } = await getRepoInfo();
  const candidateRefs = [mainBranch, `origin/${mainBranch}`];
  for (const ref of candidateRefs) {
    if (await gitIsAncestor(revision, ref)) {
      return;
    }
  }
  throw new Error(
    `Refusing to release ${revision}: it is not contained in the \`${mainBranch}\` branch.`,
  );
}

export async function getIsRelease(
  releaseOverride: null | boolean = null,
): Promise<boolean> {
  if (releaseOverride != null) {
    return releaseOverride;
  }
  if (process.argv.includes('--force-release-version')) {
    return true;
  }
  return (await getReleaseTag()) != null;
}

let cacheVersion = true;
export function useVersionCache(useCache = true): void {
  cacheVersion = useCache;
}

export interface Version {
  // null when building a detached HEAD with no discoverable branch name
  branch: null | string;
  build: string;
  info: string;
  isRelease: boolean;
  major: string;
  minor: string;
  name: string;
  npm: string;
  patch: string;
  // pre-release identifiers of the release tag, e.g. `rc.1` for tag `v1.2.3-rc.1`
  prerelease: null | string;
  // the semver git tag that triggered this release build, if any
  releaseTag: null | string;
  revision: string;
  short: string;
}

/**
 * Label used to identify a non-release build in its version string. Falls back
 * to the revision when no branch name is available.
 */
function getBuildSourceLabel({ branch, revision }: RepoInfo): string {
  return branch || revision;
}

let version: null | Version = null;
export async function getVersion(
  logIt = true,
  release: null | boolean = null,
): Promise<Version> {
  if (!cacheVersion || version == null) {
    const { name, version: pkgVersion } = getPkg();
    const repoInfo = await getRepoInfo();
    const { branch, revision } = repoInfo;
    const releaseTag = await getReleaseTag();
    const isRelease = await getIsRelease(release);
    // A release build takes its version from the git tag that triggered it;
    // everything else is a pre-release of the version in package.json.
    const semver =
      (isRelease && releaseTag) || parseSemverTag(pkgVersion.split('-')[0]);
    if (!semver) {
      throw new Error(
        `Invalid version format in package.json: \`${pkgVersion}\``,
      );
    }
    const { major, minor, patch, prerelease } = semver;
    const build = getBuild();
    const short = `${major}.${minor}.${patch}`;
    const npm = isRelease
      ? semver.version
      : `${short}-${getBuildSourceLabel(repoInfo)}.${build}`;
    const info = `${npm}+${build}.${revision}`;
    version = {
      branch,
      build,
      info,
      isRelease,
      major,
      minor,
      name,
      npm,
      patch,
      prerelease,
      releaseTag: releaseTag?.tag || null,
      revision,
      short,
    };
    if (logIt) {
      buildLog(`Building version ${info}`);
    }
  }
  return version;
}

/**
 * The npm dist-tag to publish under, following the branch/tag conventions:
 * - release tag without pre-release identifiers => `latest`
 * - release tag with pre-release identifiers => the first identifier (`rc`, `beta`, ...)
 * - untagged build of the main branch => `next`
 * - anything else => `branch`
 */
export async function getDefaultNpmDistTag(): Promise<string> {
  const { branch, isRelease, prerelease } = await getVersion();
  if (isRelease) {
    return prerelease ? prerelease.split('.')[0] : 'latest';
  }
  return branch === getMainBranch() ? 'next' : 'branch';
}

export async function getBanner(): Promise<string> {
  const { copyright = '' } = getCfg();
  const { info, name } = await getVersion();
  const today = new Date();
  return `${name} v${info} | (c) ${today.getFullYear()} ${copyright} | built on ${today.toISOString()}`;
}

export async function getVersionCode(): Promise<string> {
  return `// This file is auto-generated
export const version = ${JSON.stringify(await getVersion(), null, 2)}`;
}

export async function getUniqueBuildTag(): Promise<string> {
  const { build, revision, ...repoInfo } = await getVersion();
  return `${getBuildSourceLabel({ ...repoInfo, revision })}-${revision}-${build}`;
}
