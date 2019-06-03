// @flow
import { exec } from './cp';

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

let info = null;
export async function gitInfo(noCache: boolean = false) {
  if (!info || noCache) {
    info = {
      branch: await gitBranch(),
      revision: await gitRevId(),
    };
  }
  return info;
}
