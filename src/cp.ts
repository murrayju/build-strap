import cp from 'child_process';
import crossSpawn from 'cross-spawn';
import { promisify } from 'util';

import { buildLog } from './run.js';

export interface SpawnOptions extends cp.SpawnOptions {
  captureOutput?: boolean;
  pipeOutput?: boolean;
  rejectOnErrorCode?: boolean;
}

export interface SpawnResult {
  code: number;
  output: string;
  signal: string;
  stderr: string;
  stdout: string;
}

export async function spawn(
  command: string,
  args?: string[],
  opts?: SpawnOptions | null,
): Promise<SpawnResult> {
  const {
    captureOutput = false,
    pipeOutput = false,
    rejectOnErrorCode = true,
    ...options
  } = opts || {};

  return new Promise((resolve, reject) => {
    try {
      const toStr = () => `${command}${args ? ` ${args.join(' ')}` : ''}`;
      const p = crossSpawn(command, args, {
        ...(pipeOutput && !captureOutput ? { stdio: 'inherit' } : {}),
        ...options,
      });

      let output = '';
      let stdout = '';
      let stderr = '';
      if (captureOutput) {
        if (p.stdout) {
          if (pipeOutput) {
            p.stdout.pipe(process.stdout);
          }
          p.stdout.on('data', (d) => {
            const str = d.toString();
            stdout += str;
            output += str;
          });
        } else {
          buildLog(`Warning: cannot capture stdout for \`${toStr()}\``);
        }
        if (p.stderr) {
          if (pipeOutput) {
            p.stderr.pipe(process.stderr);
          }
          p.stderr.on('data', (d) => {
            const str = d.toString();
            stderr += str;
            output += str;
          });
        } else {
          buildLog(`Warning: cannot capture stderr for \`${toStr()}\``);
        }
      }

      let exitHandled = false;
      const handleExit = (code: number, signal: string) => {
        if (!exitHandled) {
          if (rejectOnErrorCode && code) {
            reject(new Error(`${toStr()} => ${code} (error)`));
          } else {
            resolve({
              code,
              output,
              signal,
              stderr,
              stdout,
            });
          }
          exitHandled = true;
        }
      };

      p.on('close', handleExit);

      p.on('exit', handleExit);

      // only fires if we failed to spawn
      p.on('error', (err: any) => {
        // Here we have a workaround that reverses a "feature" of cross-spawn on Windows. See:
        // https://github.com/moxystudio/node-cross-spawn/blob/master/lib/enoent.js#L23
        // https://github.com/moxystudio/node-cross-spawn/issues/104
        if (
          process.platform === 'win32' &&
          err.code === 'ENOENT' &&
          err.errno === 'ENOENT'
        ) {
          handleExit(1, 'ENOENT');
        } else {
          reject(err);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

export const exec = promisify(cp.exec);

export const onKillSignal = (cbFn: () => void) => {
  ['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, cbFn));
};
