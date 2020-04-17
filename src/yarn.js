// @flow
import md5File from 'md5-file';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { spawn } from './cp';
import type { SpawnOptions } from './cp';
import { buildLog } from './run';
import { readDir } from './fs';

export async function yarn(
  args: string[] = [],
  options?: ?SpawnOptions,
  mutexName?: string = '.yarn-mutex-build-tools-node',
  pipeOutput?: boolean,
  captureOutput?: boolean,
): Promise<string> {
  const localYarn = path.join(
    path.dirname(process.execPath),
    '/node_modules/yarn/bin/yarn.js',
  );

  const opts = {
    stdio: 'inherit',
    shell: true,
    env: process.env,
    ...options,
  };

  const theArgs = [
    '--mutex',
    `file:${path.join(os.tmpdir(), mutexName)}`,
    ...args,
  ];

  return (await fs.exists(localYarn))
    ? // prefer to use local copy of yarn
      spawn(
        process.execPath,
        [localYarn, ...theArgs],
        opts,
        pipeOutput,
        captureOutput,
      )
    : // fall back to globally installed yarn
      spawn('yarn', theArgs, opts, pipeOutput, captureOutput);
}

export const yarnFiles = ['./package.json', './yarn.lock'];

export type YarnInstallOpts = {
  nodeModulesPath?: string,
  hashFilePath?: string,
  force?: boolean,
};

// Smart yarn invocation, only if package changed
export async function yarnInstall(opts?: YarnInstallOpts) {
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

export type YarnUpgradeOpts = {
  outdated?: boolean,
};

export async function yarnUpgrade(opts?: YarnUpgradeOpts) {
  const { outdated = false } = opts || {};
  if (outdated) {
    const output = await yarn(
      ['outdated'],
      { stdio: 'pipe' },
      undefined,
      false,
      true,
    );
    const packages = output
      .split('\n')
      .slice(5, -1)
      .map((l) => l.split(/\s+/)[0]);
    await yarn(['add', ...packages]);
  } else {
    await yarn(['upgrade']);
  }
}
