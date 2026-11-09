import path from 'path';
import { fileURLToPath } from 'url';

import { buildLog, run, spawn } from '../src/index.js';

import tsc from './tsc.js';

// eslint-disable-next-line no-underscore-dangle
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

/**
 * Compiles the project and runs the tests in ./test with the Node test runner.
 * The compilation always runs, because the build copies its output.
 */
export default async function test() {
  await run(tsc);
  if (process.argv.includes('--no-test')) {
    buildLog('Skipping due to --no-test');
    return;
  }
  await spawn(process.execPath, ['--test', 'build/test'], {
    cwd: rootDir,
    stdio: 'inherit',
  });
}
