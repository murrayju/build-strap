import chokidar from 'chokidar';
import fs from 'fs-extra';
import path from 'path';

import { onKillSignal } from './cp.js';
import { cleanDir, copyDir } from './fs.js';
import { buildLog } from './run.js';

let timer: NodeJS.Timeout | null = null;
async function throttledCallback(cbFn: undefined | (() => void)) {
  if (!cbFn || typeof cbFn !== 'function') {
    return;
  }
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  timer = setTimeout(() => {
    timer = null;
    cbFn();
  }, 200);
}

export interface CopySrcOptions {
  cbFn?: () => void;
  from: string;
  to: string;
  watch?: boolean;
}

export async function copySrc({
  cbFn,
  from,
  to,
  watch = process.argv.includes('--watch'),
}: CopySrcOptions): Promise<void> {
  await copyDir(from, to);
  if (cbFn) await cbFn();
  if (watch) {
    const watcher = chokidar.watch([path.join(from, '/**/*')], {
      ignoreInitial: true,
    });

    watcher.on('all', async (event, filePath) => {
      const start = new Date();
      const src = path.relative(from, filePath);
      const dest = path.join(to, src);
      switch (event) {
        case 'add':
        case 'change':
          await fs.ensureDir(path.dirname(dest));
          await fs.copyFile(filePath, dest);
          break;
        case 'unlink':
        case 'unlinkDir':
          cleanDir(dest, { dot: true });
          break;
        default:
          return;
      }
      const end = new Date();
      const time = end.getTime() - start.getTime();
      buildLog(`${event} '${dest}' after ${time} ms`, end);
      throttledCallback(cbFn);
    });

    onKillSignal(() => watcher.close());
  }
}
