// @flow
import fs from 'fs';
import { gitInfo } from './git';
import { hgInfo } from './hg';
import { getCfg, getPkg } from './pkg';
import { buildLog } from './run';

export function getBuild(): string {
  const arg = process.argv.find((el) => /^--buildNum=\d+$/.test(el));
  return (arg && arg.substr(11)) || process.env.BUILD_NUMBER || '0';
}

export function getReleaseBranch(): string {
  const { releaseBranch } = getCfg();
  return releaseBranch || 'master';
}

type RepoType = 'git' | 'hg' | 'unknown';
export async function getRepoType(): Promise<RepoType> {
  const { repoType } = getCfg();

  return (
    repoType ||
    (fs.existsSync('./.hg')
      ? 'hg'
      : fs.existsSync('./.git')
      ? 'git'
      : 'unknown')
  );
}

type RepoInfo = {
  branch: string,
  revision: string,
};

export async function getRepoInfo(): Promise<RepoInfo> {
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

export async function getDevBranch(): Promise<string> {
  const { devBranch } = getCfg();
  return devBranch || (await getRepoType()) === 'hg' ? 'default' : 'dev';
}

export async function getIsRelease(
  passedBranch?: ?string = null,
  releaseOverride?: ?boolean = null,
): Promise<boolean> {
  const branch = passedBranch || (await getRepoInfo()).branch;
  return releaseOverride != null
    ? releaseOverride
    : process.argv.includes('--force-release-version')
    ? true
    : branch === getReleaseBranch();
}

let cacheVersion = true;
export function useVersionCache(useCache: boolean = true): void {
  cacheVersion = useCache;
}

export type Version = {|
  branch: string,
  build: string,
  info: string,
  isRelease: boolean,
  major: string,
  minor: string,
  name: string,
  npm: string,
  patch: string,
  revision: string,
  short: string,
|};

let version = null;
export async function getVersion(
  logIt: boolean = true,
  release: ?boolean = null,
): Promise<Version> {
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
    if (logIt) {
      buildLog(`Building version ${info}`);
    }
  }
  return version;
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
  const { branch, revision, build } = await getVersion();
  return `${branch}-${revision}-${build}`;
}
