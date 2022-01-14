import fs from 'fs-extra';
import fetch from 'node-fetch';
import path from 'path';

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
  const fileStream = fs.createWriteStream(saveAs);
  await new Promise((resolve, reject) => {
    body.pipe(fileStream);
    body.on('error', reject);
    fileStream.on('finish', resolve);
  });
};
