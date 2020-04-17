// @flow
import path from 'path';
import tar from 'tar';
import fs from 'fs';
import crypto from 'crypto';
import StreamCounter from 'stream-counter';
import { makeDir } from './fs';
import { buildLog } from './run';

export type ArtifactInfo = {
  md5: string,
  sha1: string,
  sha512: string,
  size: number,
  contentType?: string,
};

const generateHash = async (
  stream: stream$Readable,
  type: 'md5' | 'sha1' | 'sha512',
): Promise<string> =>
  new Promise((resolve, reject) => {
    stream
      .pipe(crypto.createHash(type).setEncoding('hex'))
      .on('finish', function () {
        resolve(this.read());
      })
      .on('end', function () {
        resolve(this.read());
      })
      .on('error', (err) => reject(err));
  });

const countBytes = async (stream: stream$Readable): Promise<number> =>
  new Promise((resolve, reject) => {
    const counter = new StreamCounter();
    stream
      .pipe(counter)
      .on('finish', () => resolve(counter.bytes))
      .on('end', () => resolve(counter.bytes))
      .on('error', (err) => reject(err));
  });

const writeStreamToFile = async (stream: stream$Readable, filePath: string) =>
  new Promise((resolve, reject) => {
    stream
      .pipe(fs.createWriteStream(filePath))
      .on('finish', () => {
        buildLog(`Successfully wrote file: ${filePath}`);
        resolve();
      })
      .on('error', (err) => reject(err));
  });

// Take the given file (path or stream) and compute the info that artifactory needs.
// md5 + sha1 hash, and size in bytes
export async function getArtifactInfo(
  artifact: string | stream$Readable,
): Promise<ArtifactInfo> {
  // make it into a stream
  const stream: stream$Readable =
    typeof artifact === 'string' ? fs.createReadStream(artifact) : artifact;

  const [md5, sha1, sha512, size] = await Promise.all([
    generateHash(stream, 'md5'),
    generateHash(stream, 'sha1'),
    generateHash(stream, 'sha512'),
    countBytes(stream),
  ]);
  return { md5, sha1, sha512, size };
}

// Creates a gzipped tarball of a directory, returns sha1 + md5 hash and size of resulting file
export async function tgzDir(
  srcDir: string,
  outPath: string,
  options?: ?{ [string]: any },
): Promise<ArtifactInfo> {
  await makeDir(path.dirname(outPath));
  const tgzStream = tar.c(
    // $FlowFixMe
    {
      gzip: true,
      cwd: srcDir,
      portable: true,
      // $FlowFixMe
      ...options,
    },
    ['.'],
  );

  // write the file to disk (outPath)
  const [info] = await Promise.all([
    getArtifactInfo(tgzStream),
    writeStreamToFile(tgzStream, `${outPath}`),
  ]);
  return {
    ...info,
    contentType: 'application/gzip',
  };
}
