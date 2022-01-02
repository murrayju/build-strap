import { spawn, SpawnOptions } from './cp.js';

/**
 * Named value pair to use when configuring an Ant build property
 */
export interface AntPropertyConfiguration {
  name: string;
  value: string;
}

export interface AntSpawnOptions {
  // Ant property values to configure
  args?: string[];
  properties?: AntPropertyConfiguration[]; // Any additional command line arguments to pass
  spawnOptions?: SpawnOptions; // Optional spawn configuration. Defaults to run the project root directory
}

/**
 * Executes the given ant command
 * @param {string} target the ant target to invoke
 * @param {AntSpawnOptions} options
 */
export async function ant(target: string, opts?: AntSpawnOptions) {
  const { properties = [], args = [], spawnOptions } = opts || {};

  await spawn(
    'ant',
    [
      target,
      ...args,
      ...properties.map(({ name, value }) => `-D${name}=${value}`),
    ],
    {
      pipeOutput: true,
      stdio: 'inherit',
      ...spawnOptions,
    },
  );
}
