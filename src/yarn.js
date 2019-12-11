// @flow
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { spawn } from './cp';

export async function yarn(
  args: string[] = [],
  options?: ?{ [string]: any },
  mutexName?: string = '.yarn-mutex-build-tools-node',
): Promise<string> {
  const localYarn = path.join(
    path.dirname(process.execPath),
    '/node_modules/yarn/bin/yarn.js',
  );

  const opts = {
    stdio: 'inherit',
    shell: true,
    env: process.env,
    // $FlowFixMe
    ...options,
  };

  const theArgs = [
    '--mutex',
    `file:${path.join(os.tmpdir(), mutexName)}`,
    ...args,
  ];

  return (await fs.exists(localYarn))
    ? // prefer to use local copy of yarn
      spawn(process.execPath, [localYarn, ...theArgs], opts)
    : // fall back to globally installed yarn
      spawn('yarn', theArgs, opts);
}
