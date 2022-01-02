import fs from 'fs-extra';
import { platform } from 'os';
import path from 'path';

import { spawn, SpawnOptions, SpawnResult } from './cp.js';
import { getCfg, getPkgName } from './pkg.js';
import { buildLog } from './run.js';
import { getDevBranch, getVersion } from './version.js';

export type NpmCreds = {
  email?: string;
  password?: string;
  username?: string;
};

export type NpmConfig = {
  access?: 'public' | 'restricted';
  dryRun?: boolean;
  name?: string;
  publish?: boolean;
  registry?: string;
};

export function getNpmConfig(): NpmConfig {
  return getCfg().npm || {};
}

export const envNpmCreds: null | NpmCreds =
  (process.env.NPM_CREDS && JSON.parse(process.env.NPM_CREDS)) || null;

const npmExe = (npmPath?: string) =>
  npmPath || (platform() === 'win32' ? 'npm.cmd' : 'npm');

export interface NpmOptions {
  args?: string[];
  npmPath?: string;
  spawnOptions?: SpawnOptions;
}

export async function npm({
  args = [],
  spawnOptions,
  npmPath,
}: NpmOptions = {}): Promise<SpawnResult> {
  const localNpm = path.join(
    path.dirname(process.execPath),
    'lib/node_modules/npm/bin/npm-cli.js',
  );

  const spawnOpts = {
    env: process.env,
    shell: true,
    stdio: 'inherit',
    ...spawnOptions,
  } as SpawnOptions;

  return npmPath
    ? spawn(npmPath, args, spawnOpts)
    : (await fs.pathExists(localNpm))
    ? // prefer to use local copy of npm
      spawn(process.execPath, [localNpm, ...args], spawnOpts)
    : // fall back to globally installed npm
      spawn(npmExe(), args, spawnOpts);
}

export async function npmGetVersions(
  packageName: string,
  npmPath?: string,
): Promise<string[]> {
  try {
    return JSON.parse(
      (
        await npm({
          args: ['show', packageName, 'versions', '--json'],
          npmPath,
          spawnOptions: {
            captureOutput: true,
            stdio: 'pipe',
          },
        })
      ).stdout.trim(),
    );
  } catch (err: any) {
    buildLog(
      `warning: failed to find existing package for ${packageName} in npm registry: ${err.message}`,
    );
    return [];
  }
}

interface NpmWriteRcOptions {
  authToken?: string;
  creds?: NpmCreds | null;
  outPath: string;
  registry?: string;
}

export async function npmWriteRc({
  authToken,
  creds,
  outPath,
  registry,
}: NpmWriteRcOptions): Promise<void> {
  // Write out .npmrc with credentials
  const theRegistry = registry || 'https://registry.npmjs.org/';
  const [, host] = /^(?:http(?:s)?:\/\/)?(.+)$/.exec(theRegistry) || [];
  await fs.mkdirp(path.dirname(outPath));
  await fs.writeFile(
    outPath,
    `registry=${theRegistry}
${authToken ? `//${host}:_authToken=${authToken}` : ''}
${
  creds
    ? `_auth=${Buffer.from(`${creds.username}:${creds.password}`).toString(
        'base64',
      )}
always-auth=true
email=${creds.email}`
    : ''
}`,
  );
}

export interface NpmPublishOptions {
  npmAuthToken?: string;
  npmConfig?: NpmConfig;
  npmCreds?: NpmCreds;
  npmPath?: string;
  // distDir, or package.tgz file
  publishPath?: string;
  skipExisting?: boolean;
  tag?: string;
  workDir?: string;
}

export async function npmPublish({
  npmAuthToken,
  npmConfig,
  npmCreds,
  npmPath,
  publishPath = '.',
  skipExisting = false,
  tag,
  workDir: passedWorkDir,
}: NpmPublishOptions = {}): Promise<boolean> {
  const creds = npmCreds || envNpmCreds;
  const authToken = npmAuthToken || process.env.NPM_TOKEN;
  const name = getPkgName();
  const { access, dryRun, publish, registry } = npmConfig || getNpmConfig();
  if (!publish) {
    buildLog(
      'npm publish info missing from package.json, skipping npm publish',
    );
    return false;
  }
  const resolvedPath = path.resolve(publishPath);
  const workDir =
    passedWorkDir ||
    ((await fs.stat(resolvedPath)).isDirectory()
      ? resolvedPath
      : path.dirname(resolvedPath));
  if (!(await fs.pathExists(path.join(workDir, 'package.json')))) {
    buildLog(
      `warning: no package.json found in ${workDir}, skipping npm publish`,
    );
    return false;
  }
  if (creds || registry || authToken) {
    // Write out .npmrc with credentials
    await npmWriteRc({
      authToken: authToken ? `\${NPM_TOKEN}` : undefined,
      creds,
      outPath: path.join(workDir, '.npmrc'),
      registry,
    });
  }
  const existing = await npmGetVersions(name, npmPath);
  const { branch, isRelease, npm: npmVersion } = await getVersion();
  if (existing.includes(npmVersion)) {
    if (skipExisting) {
      buildLog(
        'npm package with this same version already exists. Skipping publish...',
      );
      return false;
    }
    throw new Error(
      'Failed to publish npm package, this version already exists!',
    );
  }
  await npm({
    args: [
      'publish',
      resolvedPath,
      '--tag',
      tag ||
        (isRelease
          ? 'latest'
          : branch === (await getDevBranch())
          ? 'next'
          : 'branch'),
      ...(access ? ['--access', access] : []),
      ...(dryRun ? ['--dry-run'] : []),
      '--color=always',
    ],
    npmPath,
    spawnOptions: {
      cwd: workDir,
      env: {
        ...process.env,
        NPM_TOKEN: authToken,
      },
    },
  });
  return true;
}

interface NpmPackOptions {
  // directory in which to save tarball
  destination?: string;
  // use to override config in package.json
  npmConfig?: NpmConfig;
  // custom path to npm executable
  npmPath?: string;
  // directory containing package.json to pack
  workDir?: string;
}

export async function npmPack({
  destination,
  npmConfig,
  npmPath,
  workDir = '.',
}: NpmPackOptions): Promise<string> {
  const { dryRun } = npmConfig || getNpmConfig();
  if (destination) {
    await fs.ensureDir(destination);
  }
  const { stdout } = await npm({
    args: [
      'pack',
      ...(dryRun ? ['--dry-run'] : []),
      ...(destination ? ['--pack-destination', path.resolve(destination)] : []),
      '--color=always',
    ],
    npmPath,
    spawnOptions: {
      captureOutput: true,
      cwd: path.resolve(workDir),
      pipeOutput: true,
      stdio: 'pipe',
    },
  });

  return path.resolve(destination || '.', stdout.trim());
}
