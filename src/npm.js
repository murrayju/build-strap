// @flow
import { platform } from 'os';
import path from 'path';
import fs from 'fs-extra';

import { spawn, exec } from './cp';
import { getCfg, getPkgName } from './pkg';
import { getVersion } from './version';
import { buildLog } from './run';

export type NpmCreds = {
  username: string,
  password: string,
  email: string,
};

export type NpmConfig = {
  publish: boolean,
  registry?: string,
  access?: 'public' | 'restricted',
  'dry-run'?: boolean,
};

export function getNpmConfig(): NpmConfig {
  return getCfg().npm || {};
}

const envNpmCreds: ?NpmCreds =
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
  } catch (err) {
    buildLog(
      `warning: failed to find existing package for ${packageName} in npm registry: ${err.message}`,
    );
    return [];
  }
}

export async function npmPublish(
  publishPath: string, // distDir, or package.tgz file
  npmConfig?: NpmConfig,
  npmCreds?: NpmCreds,
  npmAuthToken?: string,
  tag?: string,
  skipExisting: boolean = false,
  npmPath?: string, // path to executable
) {
  const creds = npmCreds || envNpmCreds;
  const authToken = npmAuthToken || process.env.NPM_TOKEN;
  const name = getPkgName();
  const { publish, registry, access, 'dry-run': dryRun } =
    npmConfig || getNpmConfig();
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
  const { isRelease, npm: npmVersion } = await getVersion();
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
      tag || (isRelease ? 'latest' : 'next'),
      ...(access ? ['--access', access] : []),
      ...(dryRun ? ['--dry-run'] : []),
    ],
    {
      stdio: 'inherit',
      cwd: workDir,
    },
  );
  return true;
}
