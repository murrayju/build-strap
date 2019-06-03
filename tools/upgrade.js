import { yarn, buildLog } from '../src/index';

// run yarn upgrade
export default async function upgrade() {
  if (process.argv.includes('--no-upgrade')) {
    buildLog('Skipping due to --no-upgrade');
    return;
  }
  await yarn(['upgrade']);
  await yarn(['outdated']);
}
