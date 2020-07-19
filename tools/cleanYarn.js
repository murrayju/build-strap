// @flow
import { clean, buildLog } from '../src/index';

export default async function cleanYarn() {
  if (process.argv.includes('--cleanYarn-skip')) {
    buildLog('Skipping due to --cleanYarn-skip');
    return;
  }
  await clean(['./node_modules']);
}
