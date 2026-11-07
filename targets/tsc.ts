import path from 'path';
import { fileURLToPath } from 'url';

import { spawn } from '../src/index.js';

// eslint-disable-next-line no-underscore-dangle
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function tsc() {
  // Use the current node binary, not the slow `node` shim from nub
  await spawn(process.execPath, ['node_modules/.bin/tsc'], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
  });
}
