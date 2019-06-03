// @flow
import path from 'path';
import fs from 'fs-extra';
import { run, buildLog } from './run';
import { getVersion } from './version';
import { getPkgName } from './pkg';
import { artifactoryNpm, artifactoryStandard } from './artifactory';
import type { ArtifactoryConfig, ArtifactoryCreds } from './artifactory';
import { npmPublish } from './npm';
import type { NpmConfig, NpmCreds } from './npm';
import { tgzDir } from './tgz';

// tgz the distDir, and copy it to the outDir
// if toArtifactory is true, also publishes to artifactory
export async function publish(
  distDir: string, // What to bundle up and publish
  outDir: string, // Where the bundled tgz file should go
  doPublish: boolean, // Actually publish?
  prePublishFn?: () => any, // (optional) Callback to invoke before publishing
  fileName?: string, // (optional) Specify the tgz file name
  artifactoryConfig?: ArtifactoryConfig, // (optional) Artifactory config info (normally in package.json)
  artifactoryCreds?: ArtifactoryCreds, // (optional) Artifactory credentials (normally from ENV var)
  npmPath?: string, // (optional) Path to npm executable
  npmTag?: string, // (optional) tag to apply to npm package
  npmSkipExisting?: boolean = false, // (optional) if true, don't error when artifact already exists (skip publish)
  npmConfig?: NpmConfig, // (optional) Npm config info (normally in package.json)
  npmCreds?: NpmCreds, // (optional) Npm credentials (normally from ENV var)
  npmAuthToken?: string, // (optional) Npm auth token (normally from ENV var)
) {
  if (typeof prePublishFn === 'function') {
    await run(async () => {
      await prePublishFn();
    });
  }
  const version = await getVersion();
  const name = getPkgName();

  buildLog(`gzipping ${name} v${version.info}...`);

  const tgzFileName = fileName || `${name}-${version.info}.tgz`;
  const tgzFilePath = path.join(outDir, tgzFileName);
  const artifactInfo = await tgzDir(distDir, tgzFilePath, {
    prefix: 'package',
  });

  buildLog(`md5: ${artifactInfo.md5}`);
  buildLog(`sha1: ${artifactInfo.sha1}`);
  buildLog(`sha512: ${artifactInfo.sha512}`);
  buildLog(`size: ${artifactInfo.size} bytes`);

  if (!doPublish) {
    buildLog(
      'Skipping publish for dev build. Use `--publish` arg to publish for real.',
    );
    return;
  }

  // Publish to all repos configured in package.json
  await fs.copyFile(
    path.join(distDir, 'package.json'),
    path.join(outDir, 'package.json'),
  );
  const artifact = fs.createReadStream(tgzFilePath);
  await Promise.all([
    npmPublish(
      tgzFilePath,
      npmConfig,
      npmCreds,
      npmAuthToken,
      npmTag,
      npmSkipExisting,
      npmPath,
    ),
    artifactoryStandard(
      artifact,
      artifactInfo,
      tgzFileName,
      artifactoryConfig,
      artifactoryCreds,
    ),
    artifactoryNpm(
      distDir,
      artifactoryConfig,
      artifactoryCreds,
      npmPath,
      npmTag,
      npmSkipExisting,
    ),
  ]);
}
