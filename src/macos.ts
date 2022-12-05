import fs from 'fs-extra';

import { spawn } from './cp.js';
import { cmdExists, isMac } from './env.js';
import { producedPathExists } from './fs.js';
import { buildLog } from './run.js';

export const mountDmg = async (dmgPath: string, mountPath: string) => {
  await fs.ensureDir(mountPath);
  await spawn('hdiutil', [
    'attach',
    dmgPath,
    '-mountpoint',
    mountPath,
    '-nobrowse',
    '-quiet',
  ]);
};

export const unmountDmg = async (mountPath: string) => {
  await spawn('hdiutil', ['detach', mountPath, '-force', '-quiet']);
};

export const ensureXcodeCmdInstalled = async (ignoreNonMac = true) => {
  if (!isMac()) {
    if (!ignoreNonMac) {
      throw new Error('Cannot install Xcode on non-macOS');
    }
    return;
  }
  if (!(await cmdExists('xcode-select'))) {
    throw new Error('XCode is not installed, get from the app store.');
  }
  if (
    !(await producedPathExists(
      async () =>
        (
          await spawn('xcode-select', ['-p'], { captureOutput: true })
        ).output,
    ))
  ) {
    buildLog('Installing XCode Command Line Tools...');
    await spawn('sudo', ['xcode-select', '--install'], {
      stdio: 'inherit',
    });
  }
};

export const ensureRosettaInstalled = async (ignoreNonMac = true) => {
  if (!isMac()) {
    if (!ignoreNonMac) {
      throw new Error('Cannot install Rosetta on non-macOS');
    }
    return;
  }

  if (!(await fs.pathExists('/usr/libexec/rosetta'))) {
    buildLog('Installing Rosetta...');
    await spawn('softwareupdate', ['--install-rosetta', '--agree-to-license']);
  }
};
