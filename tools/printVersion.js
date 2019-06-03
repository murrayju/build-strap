import { getVersion } from '../src/index';

/**
 * Compiles the project from source files into a distributable
 * format and copies it to the output (dist) folder.
 */
export default async function printVersion() {
  console.info((await getVersion()).info);
}
