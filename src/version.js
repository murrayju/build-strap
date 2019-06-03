// @flow
import { gitInfo } from './git';
import { hgInfo } from './hg';
import { getPkg, getCfg } from './pkg';
import { buildLog } from './run';

function getBuild() {
  const arg = process.argv.find(el => /^--buildNum=\d+$/.test(el));
  return (arg && arg.substr(11)) || process.env.BUILD_NUMBER || 0;
}

export function getReleaseBranch() {
  const { releaseBranch } = getCfg();
  return releaseBranch || 'master';
}

export function getDevBranch() {
  const { devBranch, repoType } = getCfg();
  return devBranch || repoType === 'hg' ? 'default' : 'dev';
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
    const { repoType } = getCfg();
    const { branch, revision } =
      repoType === 'git'
        ? await gitInfo()
        : repoType === 'hg'
        ? await hgInfo()
        : {};
    if (!branch || !revision) {
      throw new Error('Failed to parse branch and revision from source repo.');
    }
    const [, major, minor, patch] =
      pkgVers.match(/^(\d+)\.(\d+)\.(\d+)$/) || [];
    if (!major || !minor || !patch) {
      throw new Error('Invalid version format in package.json');
    }
    const build = getBuild();
    const isRelease =
      release != null
        ? release
        : process.argv.includes('--force-release-version')
        ? true
        : branch === getReleaseBranch();
    const short = `${major}.${minor}.${patch}`;
    const npm = `${short}${isRelease ? '' : `-${branch}.${build}`}`;
    const info = `${short}${
      isRelease ? '+' : '-'
    }${branch}.${build}+${revision}`;
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
