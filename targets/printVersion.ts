import { getVersion } from '../src/index.js';

export default async function printVersion() {
  console.info((await getVersion()).info);
}
