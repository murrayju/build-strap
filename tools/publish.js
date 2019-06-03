import { run, publish, getVersion, buildLog } from '../src/index';
import build from './build';
import paths from './paths';

export default async function doPublish() {
  if (process.argv.includes('--watch')) {
    buildLog('`--watch` option is not compatible with publish.');
    return;
  }
  const version = await getVersion();

  let publishToArtifactory = process.argv.includes('--force-publish');
  if (!publishToArtifactory && process.argv.includes('--publish')) {
    if (parseInt(version.build, 10) === 0) {
      buildLog(
        'Ignoring --publish for dev build (build number is 0). Use --force-publish to override.',
      );
    } else {
      publishToArtifactory = true;
    }
  }

  if (!process.argv.includes('--publish-only')) {
    await run(build);
  }
  await run(publish, paths.dist, paths.out, publishToArtifactory);
}
