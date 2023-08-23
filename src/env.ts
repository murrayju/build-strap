import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { spawn } from './cp.js';
import { appendIfMissing, StringGenFn } from './fs.js';

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
        return path.join(os.homedir(), '.zshrc');
      case 'bash':
        return path.join(os.homedir(), '.bashrc');
      default:
        return null;
    }
  });

export const shellProfile = (): string | null =>
  cacheString('shellProfile', () => {
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
  const result = await spawn('which', [cmd], {
    captureOutput: true,
    rejectOnErrorCode: false,
  });
  if (result.code) {
    return null;
  }
  const binPath = result.stdout.trim();
  if (!binPath || !(await fs.pathExists(binPath))) {
    return null;
  }
  return binPath;
};

export const cmdExists = async (cmd: string): Promise<boolean> =>
  !!(await whichCmd(cmd));

interface ReadShellEnvVarOptions {
  envFile?: string | null;
  refreshEnv?: boolean;
  shell?: string;
}

export const readShellEnvVar = async (
  name: string,
  {
    refreshEnv = true,
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
        [
          '-c',
          `${
            refreshEnv ? `source ${envFile} > /dev/null 2>&1  && ` : ''
          }printenv ${name}`,
        ],
        {
          captureOutput: true,
          env: {
            ...process.env,
            DISABLE_AUTO_UPDATE: 'true',
          },
        },
      )
    ).stdout.trim();
  } catch {
    return null;
  }
};

export interface AppendToEnvOptions {
  envFile?: string | null;
  testContent?: string | StringGenFn;
}

export const appendToEnv = async (
  content: string | StringGenFn,
  { envFile = shellEnvFile(), testContent }: AppendToEnvOptions = {},
) => {
  if (!envFile) {
    throw new Error('envFile must be set');
  }
  await appendIfMissing(envFile, content, testContent);
};

export const appendEnvVar = async (
  name: string,
  value: string,
  { envFile = shellEnvFile() }: ReadShellEnvVarOptions = {},
) => appendToEnv(`\nexport ${name}=${value}`, { envFile });

export const ensureEnvVarValue = async (
  name: string,
  value: string,
  opts?: ReadShellEnvVarOptions,
) => {
  const currentValue = await readShellEnvVar(name, opts);
  if (currentValue !== value) {
    await appendEnvVar(name, value, opts);
  }
  process.env[name] = value;
};

export const ensureEnvVarSet = async (
  name: string,
  getValue: () => Promise<string>,
  opts?: ReadShellEnvVarOptions,
) => {
  const currentValue = await readShellEnvVar(name, opts);
  if (!currentValue) {
    const newValue = await getValue();
    await appendEnvVar(name, newValue, opts);
    process.env[name] = newValue;
  }
};

export const ensureProcessPathEnvIncludes = (binPath: string) => {
  if (!process.env.PATH?.includes(binPath)) {
    process.env.PATH = `${binPath}:${process.env.PATH}`;
  }
};
