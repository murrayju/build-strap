import { clean, run } from '../src/index.js';

import copy from './copy.js';
import lint from './lint.js';
import tsc from './tsc.js';

/**
 * Compiles the project from source files into a distributable
 * format and copies it to the output (dist) folder.
 */
export default async function build() {
  await run(clean);
  await run(lint);
  await run(tsc);
  await run(copy);
}
