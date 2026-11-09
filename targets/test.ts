import path from 'path';
import { fileURLToPath } from 'url';

import { run, spawn } from '../src/index.js';

import tsc from './tsc.js';

// eslint-disable-next-line no-underscore-dangle
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

/**
 * Compiles the project and runs the tests in ./test with the Node test runner.
 */
export default async function test() {
  await run(tsc);
  await spawn(
    process.execPath,
    // A spawn that never settles must fail its test, not block the whole run.
    ['--test', '--test-timeout=20000', 'build/test'],
    {
      cwd: rootDir,
      stdio: 'inherit',
    },
  );
}
