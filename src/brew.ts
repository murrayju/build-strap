import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { spawn, SpawnOptions } from './cp.js';
import { cmdExists } from './env.js';
import { appendIfMissing } from './fs.js';

const brewPath = async (): Promise<string> => {
  for (const testPath of [
    '/opt/homebrew/bin/brew',
    '/usr/local/bin/brew',
    '/home/linuxbrew/.linuxbrew/bin/brew',
    `${os.homedir()}/.linuxbrew/bin/brew`,
  ]) {
    if (await fs.pathExists(testPath)) {
      return testPath;
    }
  }
  throw new Error('brew not found in default install path');
};

const brewPathExists = async () => {
  try {
    return !!(await brewPath());
  } catch {
    return false;
  }
};

const appendBrewShellEnv = async () => {
  const brewDir = path.dirname(await brewPath());
  await appendIfMissing(
    path.join(os.homedir(), '.zprofile'),
    `\neval "$(${brewDir}/brew shellenv)"`,
  );
  if (!process.env.PATH?.includes(brewDir)) {
    process.env.PATH = `${brewDir}:${process.env.PATH}`;
  }
};

export const ensureBrewInstalled = async () => {
  if (!(await cmdExists('brew'))) {
    // handle the case where we have previously run `./bs` but have not yet
    // restarted shell.
    if (await brewPathExists()) {
      await appendBrewShellEnv();
      return;
    }
    await spawn(
      '/bin/bash',
      [
        '-c',
        '$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)',
      ],
      { stdio: 'inherit' },
    );
    if (!(await cmdExists('brew'))) {
      if (!(await brewPathExists())) {
        throw new Error(
          'Could not find brew executable, add it to your path manually',
        );
      }
      await appendBrewShellEnv();
    }
  }
};

export const brew = async (args: string[], options?: SpawnOptions) =>
  spawn(await brewPath(), args, options);

export const brewBundleCheck = async (brewFile: string): Promise<boolean> => {
  try {
    await brew(['bundle', 'check', '--file', brewFile]);
    return true;
  } catch {
    return false;
  }
};

export const brewBundleInstall = async (brewFile: string) => {
  await brew(['bundle', 'install', '--file', brewFile], {
    stdio: 'inherit',
  });
};

export const ensureBrewfileInstalled = async (brewFile: string) => {
  if (!(await brewBundleCheck(brewFile))) {
    await brewBundleInstall(brewFile);
  }
};
