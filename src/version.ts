import fs from 'fs';

import { gitInfo } from './git.js';
import { getCfg, getPkg } from './pkg.js';
import { buildLog } from './run.js';

export function getBuild(): string {
  const arg = process.argv.find((el) => /^--buildNum=\d+$/.test(el));
  return (arg && arg.substring(11)) || process.env.BUILD_NUMBER || '0';
}

export function getReleaseBranch(): string {
  const { releaseBranch } = getCfg();
  return releaseBranch || 'master';
}

enum RepoType {
  git = 'git',
  hg = 'hg',
  unknown = 'unknown',
}

export async function getRepoType(): Promise<RepoType> {
  const { repoType } = getCfg();

  return (
    (repoType as RepoType) ||
    (fs.existsSync('./.git')
      ? RepoType.git
      : fs.existsSync('./.hg')
      ? RepoType.hg
      : RepoType.unknown)
  );
}

type RepoInfo = {
  branch: string;
  revision: string;
};

export async function getRepoInfo(): Promise<RepoInfo> {
  const repoType = await getRepoType();
  if (repoType !== RepoType.git) {
    throw new Error(`Unsupported repo type: ${repoType}`);
  }
  const { branch, revision } = await gitInfo();
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
  passedBranch: null | string = null,
  releaseOverride: null | boolean = null,
): Promise<boolean> {
  const branch = passedBranch || (await getRepoInfo()).branch;
  return releaseOverride != null
    ? releaseOverride
    : process.argv.includes('--force-release-version')
    ? true
    : branch === getReleaseBranch();
}

let cacheVersion = true;
export function useVersionCache(useCache = true): void {
  cacheVersion = useCache;
}

export interface Version {
  branch: string;
  build: string;
  info: string;
  isRelease: boolean;
  major: string;
  minor: string;
  name: string;
  npm: string;
  patch: string;
  revision: string;
  short: string;
}

let version: null | Version = null;
export async function getVersion(
  logIt = true,
  release: null | boolean = null,
): Promise<Version> {
  if (!cacheVersion || version == null) {
    const { name, version: pkgVers } = getPkg();
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
      branch,
      build,
      info,
      isRelease,
      major,
      minor,
      name,
      npm,
      patch,
      revision,
      short,
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
  const { branch, build, revision } = await getVersion();
  return `${branch}-${revision}-${build}`;
}
