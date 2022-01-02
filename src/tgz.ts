import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { Readable } from 'stream';
import StreamCounter from 'stream-counter';
import tar from 'tar';

import { buildLog } from './run.js';

export type ArtifactInfo = {
  contentType?: string;
  md5: string;
  sha1: string;
  sha512: string;
  size: number;
};

const generateHash = async (
  stream: Readable,
  type: 'md5' | 'sha1' | 'sha512',
): Promise<string> =>
  new Promise((resolve, reject) => {
    stream
      .pipe(crypto.createHash(type).setEncoding('hex'))
      .on('finish', function onFinish(this: Readable) {
        resolve(this.read());
      })
      .on('end', function onEnd(this: Readable) {
        resolve(this.read());
      })
      .on('error', (err) => reject(err));
  });

export const generateFileHash = async (
  filePath: string,
  type: 'md5' | 'sha1' | 'sha512',
): Promise<string> => generateHash(fs.createReadStream(filePath), type);

const countBytes = async (stream: Readable): Promise<number> =>
  new Promise((resolve, reject) => {
    const counter = new StreamCounter();
    stream
      .pipe(counter)
      .on('finish', () => resolve(counter.bytes))
      .on('end', () => resolve(counter.bytes))
      .on('error', (err: Error) => reject(err));
  });

const writeStreamToFile = async (stream: Readable, filePath: string) =>
  new Promise<void>((resolve, reject) => {
    stream
      .pipe(fs.createWriteStream(filePath))
      .on('finish', () => {
        buildLog(`Successfully wrote file: ${filePath}`);
        resolve();
      })
      .on('error', (err) => reject(err));
  });

// Take the given file (path or stream) and compute metadata for it.
// md5 + sha hashes, and size in bytes
export async function getArtifactInfo(
  artifact: string | Readable,
): Promise<ArtifactInfo> {
  // make it into a stream
  const stream =
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
  options?: tar.CreateOptions,
): Promise<ArtifactInfo> {
  await fs.ensureDir(path.dirname(outPath));
  const tgzStream = tar.c(
    {
      cwd: srcDir,
      gzip: true,
      portable: true,
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
