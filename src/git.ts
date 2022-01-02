import { exec } from './cp.js';

export async function git(args: string[]): Promise<string> {
  return (await exec(`git ${args.join(' ')}`)).stdout.toString();
}

export async function gitBranch(): Promise<string> {
  return (await git(['symbolic-ref', '--short', 'HEAD']))
    .replace(/[_+/]/g, '-')
    .trim();
}

export async function gitRevId(): Promise<string> {
  return (await git(['rev-parse', '--short=12', 'HEAD']))
    .replace(/[+]/g, '')
    .trim();
}

type GitInfo = {
  branch: string;
  revision: string;
};

let info: null | GitInfo = null;
export async function gitInfo(noCache = false): Promise<GitInfo> {
  if (!info || noCache) {
    info = {
      branch: await gitBranch(),
      revision: await gitRevId(),
    };
  }
  return info;
}
