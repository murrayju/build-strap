import { clean, run } from '../src/index.js';

import copy from './copy.js';
import eslint from './eslint.js';
import tsc from './tsc.js';
import yarn from './yarn.js';

/**
 * Compiles the project from source files into a distributable
 * format and copies it to the output (dist) folder.
 */
export default async function build() {
  await run(clean);
  await run(yarn);
  await run(eslint);
  await run(tsc);
  await run(copy);
}
