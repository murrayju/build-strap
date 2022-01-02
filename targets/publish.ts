import {
  buildLog,
  getVersion,
  npmPack,
  npmPublish,
  run,
} from '../src/index.js';

import build from './build.js';

export default async function runPublish() {
  const version = await getVersion();
  const isDevBuild = parseInt(version.build, 10) === 0;

  if (!process.argv.includes('--publish-only')) {
    await run(build);
  }

  const publishPath = await npmPack({
    destination: './out',
  });

  const doPublish = process.argv.includes('--force-publish') || !isDevBuild;
  if (!doPublish) {
    buildLog(
      'Ignoring publish for dev build (build number is 0). Use --force-publish to override.',
    );
    return;
  }

  await npmPublish({ publishPath });
}
