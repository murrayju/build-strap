// @flow
import { exec } from './cp';

export async function hg(args: string[]): Promise<string> {
  return (await exec(`hg ${args.join(' ')}`)).stdout.toString();
}

export async function hgBranch() {
  return (await hg(['branch'])).replace(/[_+/]/g, '-').trim();
}

export async function hgRevId() {
  return (await hg(['id', '-i'])).replace(/[+]/g, '').trim();
}

let info = null;
export async function hgInfo(noCache: boolean = false) {
  if (!info || noCache) {
    info = {
      branch: await hgBranch(),
      revision: await hgRevId(),
    };
  }
  return info;
}
