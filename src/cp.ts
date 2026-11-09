import cp from 'child_process';
import crossSpawn from 'cross-spawn';
import { Transform } from 'stream';
import { StringDecoder } from 'string_decoder';
import { promisify } from 'util';

import { buildLog } from './run.js';

export interface SpawnOptions extends cp.SpawnOptions {
  captureOutput?: boolean;
  /**
   * Text to add to the start of each line that is piped to the current
   * process, for example `'foo: '`. Captured output has no prefix.
   */
  outputPrefix?: string;
  pipeOutput?: boolean;
  rejectOnErrorCode?: boolean;
}

/**
 * Add `prefix` to the start of every line that passes through this stream.
 *
 * A line can arrive in many chunks. The stream holds the incomplete last part
 * of a chunk until the rest of the line arrives. At the end of the stream, the
 * stream writes any remaining partial line.
 *
 * A carriage return also ends a line, so that progress output that redraws a
 * line stays readable.
 */
function createLinePrefixStream(prefix: string): Transform {
  const decoder = new StringDecoder('utf8');
  let partialLine = '';
  return new Transform({
    flush(callback) {
      const remainder = partialLine + decoder.end();
      if (remainder) {
        this.push(`${prefix}${remainder}`);
      }
      callback();
    },
    transform(chunk: Buffer, _encoding, callback) {
      // Decode with StringDecoder, so that a character that is split across
      // two chunks is not broken.
      const parts = (partialLine + decoder.write(chunk)).split(/(\r\n|\r|\n)/);
      // The last part has no line break, so the line is not complete yet.
      partialLine = parts.pop() ?? '';
      for (let index = 0; index < parts.length; index += 2) {
        this.push(`${prefix}${parts[index]}${parts[index + 1]}`);
      }
      callback();
    },
  });
}

/**
 * Copy the output of `source` into `destination`, with an optional prefix.
 *
 * The returned promise resolves after the last chunk was written, so that
 * output that follows `await spawn(...)` comes after the child output.
 */
function forwardOutput(
  source: NodeJS.ReadableStream | null,
  destination: NodeJS.WritableStream,
  prefix?: string,
): Promise<void> {
  if (!source) {
    return Promise.resolve();
  }
  const reader = prefix
    ? (source.pipe(createLinePrefixStream(prefix)) as NodeJS.ReadableStream)
    : source;
  reader.pipe(destination);
  // Resolve on either event, because a killed child can close the stream
  // without ending it.
  return new Promise((resolve) => {
    const done = () => {
      resolve();
    };
    reader.once('end', done);
    reader.once('close', done);
  });
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
    outputPrefix,
    pipeOutput = false,
    rejectOnErrorCode = true,
    ...options
  } = opts || {};

  return new Promise((resolve, reject) => {
    try {
      const toStr = () => `${command}${args ? ` ${args.join(' ')}` : ''}`;
      // The child must use pipes, not `inherit`, when we read its output to
      // capture it or to add a prefix to each line.
      const canInherit = pipeOutput && !captureOutput && !outputPrefix;
      const p = crossSpawn(command, args, {
        ...(canInherit ? { stdio: 'inherit' } : {}),
        ...options,
      });

      let output = '';
      let stdout = '';
      let stderr = '';
      if (captureOutput) {
        if (p.stdout) {
          p.stdout.on('data', (d: Buffer | string) => {
            const str = d.toString();
            stdout += str;
            output += str;
          });
        } else {
          buildLog(`Warning: cannot capture stdout for \`${toStr()}\``);
        }
        if (p.stderr) {
          p.stderr.on('data', (d: Buffer | string) => {
            const str = d.toString();
            stderr += str;
            output += str;
          });
        } else {
          buildLog(`Warning: cannot capture stderr for \`${toStr()}\``);
        }
      }

      const pipedOutput: Promise<void>[] = [];
      if (pipeOutput && !canInherit) {
        pipedOutput.push(
          forwardOutput(p.stdout, process.stdout, outputPrefix),
          forwardOutput(p.stderr, process.stderr, outputPrefix),
        );
      }

      let exitHandled = false;
      const handleExit = (code: number, signal: string) => {
        if (!exitHandled) {
          exitHandled = true;
          // Wait for the piped output, so that the last line is written before
          // the caller can write its own output.
          void Promise.all(pipedOutput).then(() => {
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
          });
        }
      };

      p.on('close', handleExit);

      // 'exit' can occur before the stdio streams are fully read. When we
      // capture output, wait for 'close' so that no output is lost.
      if (!captureOutput) {
        p.on('exit', handleExit);
      }

      // only fires if we failed to spawn
      p.on('error', (err: Error & { code?: string; errno?: string }) => {
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
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export const exec = promisify(cp.exec);

export const onKillSignal = (cbFn: () => void) => {
  ['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, cbFn));
};
