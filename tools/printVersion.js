// @flow
import { getVersion } from '../src/index';

export default async function printVersion() {
  console.info((await getVersion()).info);
}
