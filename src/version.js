// @flow
import fs from 'fs-extra';
import { gitInfo } from './git';
import { hgInfo } from './hg';
import { getPkg, getCfg } from './pkg';
import { buildLog } from './run';

function getBuild() {
  const arg = process.argv.find((el) => /^--buildNum=\d+$/.test(el));
  return (arg && arg.substr(11)) || process.env.BUILD_NUMBER || 0;
}

export function getReleaseBranch() {
  const { releaseBranch } = getCfg();
  return releaseBranch || 'master';
}

export async function getRepoType() {
  const { repoType } = getCfg();

  return (
    repoType ||
    ((await fs.exists('./.hg'))
      ? 'hg'
      : (await fs.exists('./.git'))
      ? 'git'
      : 'unknown')
  );
}

export async function getRepoInfo() {
  const repoType = await getRepoType();
  const { branch, revision } =
    repoType === 'git'
      ? await gitInfo()
      : repoType === 'hg'
      ? await hgInfo()
      : {};
  if (!branch || !revision) {
    throw new Error('Failed to parse branch and revision from source repo.');
  }
  return { branch, revision };
}

export async function getDevBranch() {
  const { devBranch } = getCfg();
  return devBranch || (await getRepoType()) === 'hg' ? 'default' : 'dev';
}

export async function getIsRelease(
  passedBranch?: ?string = null,
  releaseOverride?: ?boolean = null,
) {
  const branch = passedBranch || (await getRepoInfo()).branch;
  return releaseOverride != null
    ? releaseOverride
    : process.argv.includes('--force-release-version')
    ? true
    : branch === getReleaseBranch();
}

let cacheVersion = true;
export function useVersionCache(useCache: boolean = true) {
  cacheVersion = useCache;
}

let version = null;
export async function getVersion(
  logIt: boolean = true,
  release: ?boolean = null,
) {
  if (!cacheVersion || version == null) {
    const { version: pkgVers, name } = getPkg();
    const { branch, revision } = await getRepoInfo();
    const [, major, minor, patch] =
      pkgVers.match(/^(\d+)\.(\d+)\.(\d+)$/) || [];
    if (!major || !minor || !patch) {
      throw new Error('Invalid version format in package.json');
    }
    const build = getBuild();
    const isRelease = await getIsRelease(branch, release);
    const short = `${major}.${minor}.${patch}`;
    const npm = `${short}${isRelease ? '' : `-${branch}.${build}`}`;
    const info = `${short}${
      isRelease ? `+${build}.` : `-${branch}.${build}+`
    }${revision}`;
    version = {
      name,
      branch,
      revision,
      major,
      minor,
      patch,
      build,
      short,
      isRelease,
      npm,
      info,
    };
    if (logIt) buildLog(`Building version ${info}`);
  }
  return version;
}

export async function getBanner() {
  const { copyright = '' } = getCfg();
  const { info, name } = await getVersion();
  const today = new Date();
  return `${name} v${info} | (c) ${today.getFullYear()} ${copyright} | built on ${today.toISOString()}`;
}

export async function getVersionCode() {
  return `// This file is auto-generated
export const version = ${JSON.stringify(await getVersion(), null, 2)}`;
}

export async function getUniqueBuildTag() {
  const { branch, revision, build } = await getVersion();
  return `${branch}-${revision}-${build}`;
}
