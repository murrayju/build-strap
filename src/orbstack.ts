import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { brew } from './brew';
import { spawn } from './cp';
import { dockerIsRunning } from './docker';
import { cmdExists, isMac } from './env';
import { buildLog } from './run';

export const ensureOrbStackInstalled = async () => {
  if (!isMac()) {
    throw new Error('OrbStack is only supported on macOS');
  }
  if (!(await cmdExists('orb'))) {
    await brew(['install', 'orbstack']);
  }
};

export const ensureOrbStackRunning = async (timeoutSeconds = 600) => {
  if (!(await dockerIsRunning())) {
    if (!isMac()) {
      throw new Error('OrbStack is only supported on macOS');
    }
    buildLog('docker is not running, starting OrbStack...');
    await spawn('open', ['-a', '/Applications/OrbStack.app']);

    let attempts = 0;
    while (!(await dockerIsRunning())) {
      attempts += 1;
      if (attempts % 5 === 0) {
        process.stdout.write('.');
      }
      if (attempts > timeoutSeconds) {
        throw new Error('Timeout starting OrbStack');
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 1000);
      });
    }
    if (attempts >= 5) {
      process.stdout.write('\n');
    }
  }
};

const defaultConfig = {
  memory_mib: 16384,
};

export const ensureOrbStackConfigured = async (
  desiredConfig?: null | Record<string, unknown>,
) => {
  if (!desiredConfig) {
    buildLog('Skipping OrbStack configuration due to empty config value');
    return;
  }
  if (!isMac()) {
    throw new Error('OrbStack is only supported on macOS');
  }
  const configPath = path.join(os.homedir(), '.orbstack/vmconfig.json');
  await fs.ensureDir(path.dirname(configPath));
  let changed = false;
  if (!(await fs.pathExists(configPath))) {
    buildLog('Setting OrbStack config...');
    await fs.writeJson(configPath, desiredConfig, { spaces: 2 });
    changed = true;
  } else {
    const existingConfig = await fs.readJson(configPath);
    const effectiveConfig = {
      ...defaultConfig,
      ...existingConfig,
    };
    if (
      !Object.entries(desiredConfig).every(
        ([key, value]) => effectiveConfig[key] === value,
      )
    ) {
      buildLog('Adjusting OrbStack config...');
      const newConfig = {
        ...existingConfig,
        ...desiredConfig,
      };
      for (const [key, value] of Object.entries(defaultConfig)) {
        if (newConfig[key] === value) {
          // Don't write default values
          delete newConfig[key];
        }
      }
      await fs.writeJson(configPath, newConfig, { spaces: 2 });
      changed = true;
    }
  }

  if (changed && (await dockerIsRunning())) {
    // Restart the app
    buildLog('Killing OrbStack...');
    await spawn('osascript', ['-e', `quit app "OrbStack"`]);
    await ensureOrbStackRunning();
  }
};
