import fs from 'fs-extra';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

export const downloadFile = async (
  url: string,
  saveAs: string,
  overwrite = true,
) => {
  const res = await fetch(url);
  const { body, ok } = res;
  if (!ok || !body) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  await fs.ensureDir(path.dirname(saveAs));
  if (overwrite) {
    await fs.remove(saveAs);
  }
  await pipeline(Readable.fromWeb(body), fs.createWriteStream(saveAs));
};
