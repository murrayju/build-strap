// @flow
import md5File from 'md5-file';
import fs from 'fs-extra';
import path from 'path';
import { spawnAdv } from './cp';
import type { SpawnOptions, SpawnResult } from './cp';
import { buildLog } from './run';
import { readDir } from './fs';
import { getPkg } from './pkg';

export type YarnOptions = {|
  args?: string[],
  spawnOptions?: ?SpawnOptions,
|};

export async function yarnAdv(opts?: YarnOptions): Promise<SpawnResult> {
  const { args = [], spawnOptions } = opts || {};
  const localYarn = path.join(
    path.dirname(process.execPath),
    '/node_modules/yarn/bin/yarn.js',
  );

  const spawnOpts = {
    stdio: 'inherit',
    shell: true,
    env: process.env,
    ...spawnOptions,
  };

  return (await fs.exists(localYarn))
    ? // prefer to use local copy of yarn
      spawnAdv(process.execPath, [localYarn, ...args], spawnOpts)
    : // fall back to globally installed yarn
      spawnAdv('yarn', args, spawnOpts);
}

export async function yarn(opts?: YarnOptions): Promise<string> {
  const { args = [], spawnOptions } = opts || {};
  return yarnAdv({
    args,
    spawnOptions: { rejectOnErrorCode: true, ...spawnOptions },
  }).then((r) => r.output);
}

export const yarnFiles = ['./package.json', './yarn.lock'];

export type YarnInstallOptions = {|
  nodeModulesPath?: string,
  hashFilePath?: string,
  force?: boolean,
|};

// Smart yarn invocation, only if package changed
export async function yarnInstall(opts?: YarnInstallOptions) {
  const {
    nodeModulesPath = './node_modules',
    hashFilePath = './download/buildHash_yarn.md5',
    force = false,
  } = opts || {};
  await fs.ensureDir(nodeModulesPath);
  const currentHash = (
    await Promise.all(yarnFiles.map(async (f) => md5File(f)))
  ).join('|');
  await fs.ensureFile(hashFilePath);
  const prevHash = await fs.readFile(hashFilePath, 'utf8');
  if (currentHash !== prevHash) {
    buildLog(
      'node package definition changed since last build, invoking yarn.',
    );
  } else if (!(await readDir(`${nodeModulesPath}/**/*.js`)).length) {
    buildLog('node packages missing, invoking yarn.');
  } else if (force) {
    buildLog('node packages unchanged, but yarn forced on command line...');
  } else {
    buildLog('node packages unchanged since last build, skipping yarn.');
    return;
  }
  await yarn();
  await fs.writeFile(hashFilePath, currentHash);
}

export type YarnUpgradeOptions = {|
  /**
   * Use `yarn outdated` to find packages that should be upgraded
   * May include breaking changes (major version changes)
   */
  outdated?: boolean,
  /**
   * `false` by default
   * we assume any package with an explicit version shouldn't be touched
   */
  all?: boolean,
|};

export async function yarnUpgrade(opts?: YarnUpgradeOptions) {
  const { outdated = false, all = false } = opts || {};
  if (outdated) {
    const { code, stdout } = await yarnAdv({
      args: ['outdated'],
      spawnOptions: { stdio: 'pipe', captureOutput: true },
    });
    if (code === 0) {
      buildLog('No outdated packages.');
    } else {
      const { dependencies = {}, devDependencies = {} } = getPkg();
      const packages = stdout
        .split('\n')
        .slice(5, -1)
        .map((l) => l.split(/\s+/)[0])
        .filter(
          (p) =>
            all || !/^\d/.test(dependencies[p] || devDependencies[p] || ''),
        );
      if (packages.length) {
        await yarn({ args: ['add', ...packages] });
        buildLog(`Upgraded: ${packages.join(', ')}`);
      } else {
        buildLog('No eligible outdated packages');
      }
    }
  } else {
    await yarn({ args: ['upgrade'] });
  }
}
