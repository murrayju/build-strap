// @flow
import path from 'path';
import fs from 'fs-extra';
import { run, buildLog } from './run';
import { getVersion, type Version } from './version';
import { getPkgName } from './pkg';
import {
  artifactoryNpm,
  artifactoryStandard,
  type ArtifactoryConfig,
  type ArtifactoryCreds,
} from './artifactory';
import { npmPublish } from './npm';
import type { NpmConfig, NpmCreds } from './npm';
import { tgzDir, type ArtifactInfo } from './tgz';

export type CreateArtifactOptions = {
  distDir: string, // What to bundle up and publish
  outDir: string, // Where the bundled tgz file should go
  fileName?: string, // (optional) Specify the tgz file name
};

export type Artifact = {
  name: string,
  version: Version,
  info: ArtifactInfo,
  fileName: string,
  filePath: string,
}

// create tgz from distDir in outDir
export async function createArtifact({
  distDir,
  outDir,
  fileName,
}: CreateArtifactOptions): Promise<Artifact> {
  const version = await getVersion();
  const name = getPkgName();

  buildLog(`gzipping ${name} v${version.info}...`);

  const tgzFileName = fileName || `${name}-${version.info}.tgz`;
  const tgzFilePath = path.join(outDir, tgzFileName);
  const info = await tgzDir(distDir, tgzFilePath, {
    prefix: 'package',
  });

  buildLog(`md5: ${info.md5}`);
  buildLog(`sha1: ${info.sha1}`);
  buildLog(`sha512: ${info.sha512}`);
  buildLog(`size: ${info.size} bytes`);

  return {
    name,
    version,
    info,
    fileName: tgzFileName,
    filePath: tgzFilePath,
  };
}

export type PublishConfiguration = {
  ...CreateArtifactOptions,
  doPublish: boolean, // Actually publish?
  prePublishFn?: () => any, // (optional) Callback to invoke before publishing
  artifactoryConfig?: ArtifactoryConfig, // (optional) Artifactory config info (normally in package.json)
  artifactoryCreds?: ArtifactoryCreds, // (optional) Artifactory credentials (normally from ENV var)
  npmPath?: string, // (optional) Path to npm executable
  npmTag?: string, // (optional) tag to apply to npm package
  npmSkipExisting?: boolean, // (optional) if true, don't error when artifact already exists (skip publish)
  npmConfig?: NpmConfig, // (optional) Npm config info (normally in package.json)
  npmCreds?: NpmCreds, // (optional) Npm credentials (normally from ENV var)
  npmAuthToken?: string, // (optional) Npm auth token (normally from ENV var)
};

// tgz the distDir, and copy it to the outDir
// if toArtifactory is true, also publishes to artifactory
export async function publish({
  distDir,
  outDir,
  doPublish,
  prePublishFn,
  fileName,
  artifactoryConfig,
  artifactoryCreds,
  npmPath,
  npmTag,
  npmSkipExisting = false,
  npmConfig,
  npmCreds,
  npmAuthToken,
}: PublishConfiguration) {
  if (typeof prePublishFn === 'function') {
    await run(async () => {
      await prePublishFn();
    });
  }

  const {
    info,
    filePath: tgzFilePath,
    fileName: tgzFileName,
  } = await createArtifact({ distDir, outDir, fileName });

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
    npmPublish({
      publishPath: tgzFilePath,
      npmConfig,
      npmCreds,
      npmAuthToken,
      tag: npmTag,
      skipExisting: npmSkipExisting,
      npmPath,
    }),
    artifactoryStandard(
      artifact,
      info,
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
