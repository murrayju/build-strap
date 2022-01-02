import path from 'path';
import { fileURLToPath } from 'url';

import { spawn } from '../src/index.js';

// eslint-disable-next-line no-underscore-dangle
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default async function tsc() {
  await spawn('tsc', [], {
    cwd: path.resolve(__dirname, '..'),
    shell: true,
    stdio: 'inherit',
  });
}
