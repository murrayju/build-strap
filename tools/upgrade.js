import { yarnUpgrade, buildLog } from '../src/index';

// run yarn upgrade
export default async function upgrade(
  outdated = process.argv.includes('--outdated'),
) {
  if (process.argv.includes('--no-upgrade')) {
    buildLog('Skipping due to --no-upgrade');
    return;
  }
  await yarnUpgrade({ outdated });
}
