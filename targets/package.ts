import { npmPack, run } from '../src/index.js';

import build from './build.js';

/**
 * Uses "npm pack" to create a tarball in ./out.
 */
export default async function runPackage(): Promise<string> {
  if (!process.argv.includes('--package-only')) {
    await run(build);
  }

  return npmPack({
    destination: './out',
    workDir: './dist',
  });
}
