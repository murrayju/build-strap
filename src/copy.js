// @flow
import path from 'path';
import chokidar from 'chokidar';
import { copyFile, makeDir, copyDir, cleanDir } from './fs';
import { onKillSignal } from './cp';
import { buildLog } from './run';
import { dependencies } from './inline-resources';

let timer = null;
async function throttledCallback(cbFn) {
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

export type CopySrcOptions = {
  from: string,
  to: string,
  watch?: boolean,
  cbFn?: () => Promise<any> | void,
};

export async function copySrc({
  from,
  to,
  watch = process.argv.includes('--watch'),
  cbFn,
}: CopySrcOptions = {}): Promise<void> {
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
          await makeDir(path.dirname(dest));
          await copyFile(filePath, dest);
          break;
        case 'unlink':
        case 'unlinkDir':
          cleanDir(dest, { nosort: true, dot: true });
          break;
        default:
          return;
      }
      // Check dependencies
      if (dependencies[dest]) {
        await Promise.all(
          dependencies[dest].map(async (dep) => {
            const toCopy = path.join(from, path.relative(to, dep));
            await copyFile(toCopy, dep);
            buildLog(`copied '${dep}' due to changed dependency`);
          }),
        );
      }
      const end = new Date();
      const time = end.getTime() - start.getTime();
      buildLog(`${event} '${dest}' after ${time} ms`, end);
      throttledCallback(cbFn);
    });

    onKillSignal(() => watcher.close());
  }
}
