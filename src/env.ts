import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { spawn } from './cp.js';
import { appendIfMissing } from './fs.js';

const boolCache = new Map<string, boolean>();
const cacheBool = (key: string, fn: () => boolean): boolean => {
  if (!boolCache.has(key)) {
    boolCache.set(key, fn());
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return boolCache.get(key)!;
};

export const isMac = (): boolean =>
  cacheBool('isMac', () => os.platform() === 'darwin');
export const isLinux = (): boolean =>
  cacheBool('isLinux', () => os.platform() === 'linux');
export const isWindows = (): boolean =>
  cacheBool('isWindows', () => os.platform() === 'win32');
export const isArm = (): boolean =>
  cacheBool(
    'isArm',
    () =>
      os.arch() === 'arm64' ||
      (isMac() && os.cpus().some((cpu) => cpu.model.includes(' M1 '))),
  );
export const isAppleSilicon = (): boolean =>
  cacheBool('isAppleSilicon', () => isMac() && isArm());

const stringCache = new Map<string, string | null>();
const cacheString = (key: string, fn: () => string | null): string => {
  if (!stringCache.has(key)) {
    stringCache.set(key, fn());
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return stringCache.get(key)!;
};

export const shellType = (): string | null =>
  cacheString('shellType', () => os.userInfo().shell.split('/').pop() || null);

export const shellEnvFile = (): string | null =>
  cacheString('shellEnvFile', () => {
    switch (shellType()) {
      case 'zsh':
        return path.join(os.homedir(), '.zprofile');
      case 'bash':
        return path.join(os.homedir(), '.bash_profile');
      default:
        return null;
    }
  });

export const whichCmd = async (cmd: string): Promise<null | string> => {
  const binPath = (
    await spawn('which', [cmd], { captureOutput: true })
  ).output.trim();
  if (!binPath || !(await fs.pathExists(binPath))) {
    return null;
  }
  return binPath;
};

export const cmdExists = async (cmd: string): Promise<boolean> =>
  !!whichCmd(cmd);

interface ReadShellEnvVarOptions {
  envFile?: string | null;
  refreshEnv?: boolean;
  shell?: string;
}

export const readShellEnvVar = async (
  name: string,
  {
    refreshEnv = false,
    envFile = shellEnvFile(),
    shell = os.userInfo().shell,
  }: ReadShellEnvVarOptions = {},
): Promise<string | null> => {
  if (refreshEnv && (!envFile || !(await fs.pathExists(envFile)))) {
    throw new Error(`Could not find shell env file: ${envFile}`);
  }
  try {
    return (
      await spawn(
        shell,
        ['-c', `${refreshEnv ? `source ${envFile} && ` : ''}printenv ${name}`],
        {
          captureOutput: true,
        },
      )
    ).stdout.trim();
  } catch {
    return null;
  }
};

export const appendEnvVarToProfile = async (
  name: string,
  value: string,
  { envFile = shellEnvFile() }: ReadShellEnvVarOptions = {},
) => {
  if (!envFile) {
    throw new Error('envFile must be set');
  }
  await appendIfMissing(
    path.join(os.homedir(), envFile),
    `\nexport ${name}=${value}`,
  );
};

export const ensureEnvVarValue = async (
  name: string,
  value: string,
  opts?: ReadShellEnvVarOptions,
) => {
  const currentValue = await readShellEnvVar(name, opts);
  if (currentValue !== value) {
    await appendEnvVarToProfile(name, value, opts);
  }
  process.env[name] = value;
};

export const ensureEnvVarSet = async (
  name: string,
  getValue: () => Promise<string>,
) => {
  const currentValue = await readShellEnvVar(name);
  if (!currentValue) {
    const newValue = await getValue();
    await appendEnvVarToProfile(name, newValue);
    process.env[name] = newValue;
  }
};
