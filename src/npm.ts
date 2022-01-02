import fs from 'fs-extra';
import { platform } from 'os';
import path from 'path';

import { exec, spawn } from './cp.js';
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

const envNpmCreds: null | NpmCreds =
  (process.env.NPM_CREDS && JSON.parse(process.env.NPM_CREDS)) || null;

const npmExe = (npmPath?: string) =>
  npmPath || (platform() === 'win32' ? 'npm.cmd' : 'npm');

export async function npmExec(
  args: string[],
  npmPath?: string,
): Promise<string> {
  return (await exec(`${npmExe(npmPath)} ${args.join(' ')}`)).stdout.toString();
}

export async function npmGetVersions(
  packageName: string,
  npmPath?: string,
): Promise<string[]> {
  try {
    return JSON.parse(
      await npmExec(['show', packageName, 'versions'], npmPath),
    );
  } catch (err: any) {
    buildLog(
      `warning: failed to find existing package for ${packageName} in npm registry: ${err.message}`,
    );
    return [];
  }
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
}

export async function npmPublish({
  npmAuthToken,
  npmConfig,
  npmCreds,
  npmPath,
  publishPath = '.',
  skipExisting = false,
  tag,
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
  const workDir = (await fs.stat(resolvedPath)).isDirectory()
    ? resolvedPath
    : path.dirname(resolvedPath);
  if (creds || registry || authToken) {
    // Write out .npmrc with credentials
    const theRegistry = registry || 'https://registry.npmjs.org/';
    const [, host] = /^(?:http(?:s)?:\/\/)?(.+)$/.exec(theRegistry) || [];
    await fs.mkdirp(workDir);
    await fs.writeFile(
      path.join(workDir, '.npmrc'),
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
  await spawn(
    npmExe(npmPath),
    [
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
    {
      cwd: workDir,
      stdio: 'inherit',
    },
  );
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
  const { stdout } = await spawn(
    npmExe(npmPath),
    [
      'pack',
      ...(dryRun ? ['--dry-run'] : []),
      ...(destination ? ['--pack-destination', destination] : []),
      '--color=always',
    ],
    {
      captureOutput: true,
      cwd: workDir,
      pipeOutput: true,
    },
  );

  return path.resolve(destination || '.', stdout.trim());
}
