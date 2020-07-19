// @flow
import { spawn } from './cp';
import type { SpawnOptions } from './cp';

/**
 * Named value pair to use when configuring an Ant build property
 */
export type AntPropertyConfiguration = {|
  name: string,
  value: string,
|};

export type AntSpawnOptions = {|
  properties?: AntPropertyConfiguration[], // Ant property values to configure
  args?: string[], // Any additional command line arguments to pass
  spawnOptions?: SpawnOptions, // Optional spawn configuration. Defaults to run the project root directory
|};

/**
 * Executes the given ant command
 * @param {string} target the ant target to invoke
 * @param {AntSpawnOptions} options
 */
export async function ant(target: string, opts?: AntSpawnOptions) {
  const { properties = [], args = [], spawnOptions } = opts || {};

  const execOptions = {
    stdio: 'inherit',
    pipeOutput: true,
    ...spawnOptions,
  };

  await spawn(
    'ant',
    [
      target,
      ...args,
      ...properties.map(({ name, value }) => `-D${name}=${value}`),
    ],
    execOptions,
  );
}
