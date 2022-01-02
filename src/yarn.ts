import fs from 'fs-extra';
import path from 'path';

import { spawn, SpawnOptions, SpawnResult } from './cp.js';
import { readDir } from './fs.js';
import { getPkg } from './pkg.js';
import { buildLog } from './run.js';
import { generateFileHash } from './tgz.js';

export interface YarnOptions {
  args?: string[];
  spawnOptions?: SpawnOptions;
}

export async function yarn({
  args = [],
  spawnOptions,
}: YarnOptions = {}): Promise<SpawnResult> {
  const localYarn = path.join(
    path.dirname(process.execPath),
    '/node_modules/yarn/bin/yarn.js',
  );

  const spawnOpts = {
    env: process.env,
    shell: true,
    stdio: 'inherit',
    ...spawnOptions,
  } as SpawnOptions;

  return (await fs.pathExists(localYarn))
    ? // prefer to use local copy of yarn
      spawn(process.execPath, [localYarn, ...args], spawnOpts)
    : // fall back to globally installed yarn
      spawn('yarn', args, spawnOpts);
}

export const yarnFiles = ['./package.json', './yarn.lock'];

export interface YarnInstallOptions {
  force?: boolean;
  hashFilePath?: string;
  nodeModulesPath?: string;
}

// Smart yarn invocation, only if package changed
export async function yarnInstall({
  force = false,
  hashFilePath = './download/buildHash_yarn.md5',
  nodeModulesPath = './node_modules',
}: YarnInstallOptions = {}) {
  await fs.ensureDir(nodeModulesPath);
  const currentHash = (
    await Promise.all(yarnFiles.map(async (f) => generateFileHash(f, 'md5')))
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

export interface YarnUpgradeOptions {
  /**
   * `false` by default
   * we assume any package with an explicit version shouldn't be touched
   */
  all?: boolean;
  /**
   * Use `yarn outdated` to find packages that should be upgraded
   * May include breaking changes (major version changes)
   */
  outdated?: boolean;
}

export async function yarnUpgrade({
  all = false,
  outdated = false,
}: YarnUpgradeOptions = {}) {
  if (outdated) {
    const { code, stdout } = await yarn({
      args: ['outdated'],
      spawnOptions: {
        captureOutput: true,
        rejectOnErrorCode: false,
        stdio: 'pipe',
      },
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
  }
  await yarn({ args: ['upgrade'] });
}
