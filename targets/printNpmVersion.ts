import { getVersion } from '../src/index.js';

export default async function printNpmVersion() {
  console.info((await getVersion()).npm);
}
