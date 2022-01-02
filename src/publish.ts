import fs from 'fs-extra';
import path from 'path';

import { NpmConfig, NpmCreds, npmPublish } from './npm.js';
import { getPkgName } from './pkg.js';
import { buildLog, run } from './run.js';
import { ArtifactInfo, tgzDir } from './tgz.js';
import { getVersion, type Version } from './version.js';

export interface CreateArtifactOptions {
  distDir: string; // What to bundle up and publish
  fileName?: string; // (optional) Specify the tgz file name
  outDir: string; // Where the bundled tgz file should go
}

export interface Artifact {
  fileName: string;
  filePath: string;
  info: ArtifactInfo;
  name: string;
  version: Version;
}

// create tgz from distDir in outDir
export async function createArtifact({
  distDir,
  fileName,
  outDir,
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
    fileName: tgzFileName,
    filePath: tgzFilePath,
    info,
    name,
    version,
  };
}

export interface PublishConfiguration extends CreateArtifactOptions {
  doPublish: boolean; // Actually publish?
  npmAuthToken?: string; // (optional) Npm auth token (normally from ENV var)
  npmConfig?: NpmConfig; // (optional) Npm config info (normally in package.json)
  npmCreds?: NpmCreds; // (optional) Npm credentials (normally from ENV var)
  npmPath?: string; // (optional) Path to npm executable
  npmSkipExisting?: boolean; // (optional) if true, don't error when artifact already exists (skip publish)
  npmTag?: string; // (optional) tag to apply to npm package
  prePublishFn?: () => any; // (optional) Callback to invoke before publishing
}

// tgz the distDir, and copy it to the outDir
export async function publish({
  distDir,
  doPublish,
  fileName,
  npmAuthToken,
  npmConfig,
  npmCreds,
  npmPath,
  npmSkipExisting = false,
  npmTag,
  outDir,
  prePublishFn,
}: PublishConfiguration) {
  if (typeof prePublishFn === 'function') {
    await run(async () => {
      await prePublishFn();
    });
  }

  const { filePath: tgzFilePath } = await createArtifact({
    distDir,
    fileName,
    outDir,
  });

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
  await npmPublish({
    npmAuthToken,
    npmConfig,
    npmCreds,
    npmPath,
    publishPath: tgzFilePath,
    skipExisting: npmSkipExisting,
    tag: npmTag,
  });
}
