// @flow
import { exec } from './cp';

export async function hg(args: string[], cwd?: string): Promise<string> {
  // $FlowFixMe
  return (await exec(`hg ${args.join(' ')}`, cwd ? { cwd } : {})).stdout;
}

export async function hgBranch(cwd?: string): Promise<string> {
  return (await hg(['branch'], cwd)).replace(/[_+/]/g, '-').trim();
}

export async function hgRevId(cwd?: string): Promise<string> {
  return (await hg(['id', '-i'], cwd)).replace(/[+]/g, '').trim();
}

type HgInfo = {
  branch: string,
  revision: string,
};

let info = null;
export async function hgInfo(
  noCache: boolean = false,
  cwd?: string,
): Promise<HgInfo> {
  if (!info || noCache) {
    info = {
      branch: await hgBranch(cwd),
      revision: await hgRevId(cwd),
    };
  }
  return info;
}
