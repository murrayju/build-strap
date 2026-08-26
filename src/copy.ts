import { watch as chokidarWatch } from 'chokidar';
import fs from 'fs-extra';
import path from 'path';

import { onKillSignal } from './cp.js';
import { cleanDir, copyDir } from './fs.js';
import { buildLog, errorMessage } from './run.js';

/**
 * Callback invoked after a copy completes. May be sync or async; a returned
 * promise is awaited.
 */
export type CopySrcCallback = () => Promise<void> | void;

let timer: NodeJS.Timeout | null = null;
function throttledCallback(cbFn: CopySrcCallback | undefined) {
  if (!cbFn || typeof cbFn !== 'function') {
    return;
  }
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  timer = setTimeout(() => {
    timer = null;
    // the callback may be async, so surface a rejection instead of leaving it
    // floating on the timer
    void (async () => {
      try {
        await cbFn();
      } catch (e) {
        buildLog(`Error in copySrc callback: ${errorMessage(e)}`);
      }
    })();
  }, 200);
}

export interface CopySrcOptions {
  cbFn?: CopySrcCallback;
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
    // chokidar v4 removed glob support; watch the directory recursively instead
    const watcher = chokidarWatch(from, {
      ignoreInitial: true,
    });

    // chokidar's typings expect a void-returning listener, so the async work
    // is wrapped and its rejection handled rather than left floating
    const handleEvent = async (event: string, filePath: string) => {
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
          // must be awaited: otherwise the log below (and the throttled
          // callback) can fire before the delete actually completes
          await cleanDir(dest, { dot: true });
          break;
        default:
          return;
      }
      const end = new Date();
      const time = end.getTime() - start.getTime();
      buildLog(`${event} '${dest}' after ${time} ms`, end);
      throttledCallback(cbFn);
    };

    watcher.on('all', (event, filePath) => {
      handleEvent(event, filePath).catch((e: unknown) => {
        buildLog(`Error handling ${event} for ${filePath}: ${errorMessage(e)}`);
      });
    });

    onKillSignal(() => {
      void watcher.close();
    });
  }
}
