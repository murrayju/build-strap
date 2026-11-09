import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import { brew } from './brew.js';
import { spawn, SpawnOptions, SpawnResult } from './cp.js';
import {
  dockerIsRunning,
  getDockerInfo,
  throwIfDockerUnresponsive,
  waitForDockerToStart,
} from './docker.js';
import { cmdExists, isMac } from './env.js';
import { buildLog } from './run.js';

export const ensureOrbStackInstalled = async (
  options?: SpawnOptions,
): Promise<SpawnResult | null> => {
  if (!isMac()) {
    throw new Error('OrbStack is only supported on macOS');
  }
  if (!(await cmdExists('orb'))) {
    return brew(['install', 'orbstack'], options);
  }
  return null;
};

export const ensureOrbStackRunning = async (timeoutSeconds = 600) => {
  const info = await getDockerInfo();
  if (info.status === 'running') {
    return;
  }
  throwIfDockerUnresponsive(info);
  if (!isMac()) {
    throw new Error('OrbStack is only supported on macOS');
  }
  buildLog('docker is not running, starting OrbStack...');
  await spawn('open', ['-a', '/Applications/OrbStack.app']);
  await waitForDockerToStart(timeoutSeconds, 'OrbStack');
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
    const existingConfig = (await fs.readJson(configPath)) as Record<
      string,
      unknown
    >;
    const effectiveConfig: Record<string, unknown> = {
      ...defaultConfig,
      ...existingConfig,
    };
    if (
      !Object.entries(desiredConfig).every(
        ([key, value]) => effectiveConfig[key] === value,
      )
    ) {
      buildLog('Adjusting OrbStack config...');
      const defaults: Record<string, unknown> = defaultConfig;
      // Don't write values that already match the defaults
      const newConfig = Object.fromEntries(
        Object.entries({
          ...existingConfig,
          ...desiredConfig,
        }).filter(([key, value]) => defaults[key] !== value),
      );
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
