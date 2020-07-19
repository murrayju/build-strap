// @flow
import cp from 'child_process';
import crossSpawn from 'cross-spawn';
import { buildLog } from './run';

export type NativeSpawnOptions = {|
  cwd?: string,
  env?: Object,
  argv0?: string,
  stdio?: string | Array<any>,
  detached?: boolean,
  uid?: number,
  gid?: number,
  shell?: boolean | string,
  windowsVerbatimArguments?: boolean,
  windowsHide?: boolean,
|};

export type SpawnOptions = {|
  ...NativeSpawnOptions,
  pipeOutput?: boolean,
  captureOutput?: boolean,
  rejectOnErrorCode?: boolean,
|};

export type SpawnResult = {|
  output: string,
  stdout: string,
  stderr: string,
  code: number,
  signal: string,
|};

export async function spawnAdv(
  command: string,
  args?: string[],
  opts?: ?SpawnOptions,
): Promise<SpawnResult> {
  const {
    pipeOutput = false,
    captureOutput = false,
    rejectOnErrorCode = false,
    ...options
  } = opts || {};

  return new Promise((resolve, reject) => {
    try {
      const toStr = () => `${command}${args ? ` ${args.join(' ')}` : ''}`;
      const p = crossSpawn(command, args, {
        ...options,
        // $FlowFixMe
        ...(pipeOutput && !captureOutput && !(options && options.stdio)
          ? { stdio: 'inherit' }
          : {}),
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
      const handleExit = (code, signal) => {
        if (!exitHandled) {
          if (rejectOnErrorCode && code) {
            reject(new Error(`${toStr()} => ${code} (error)`));
          } else {
            resolve({
              output,
              stdout,
              stderr,
              code,
              signal,
            });
          }
          exitHandled = true;
        }
      };

      p.on('close', handleExit);

      p.on('exit', handleExit);

      // only fires if we failed to spawn
      p.on('error', (err) => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

// older, simpler interface that just returns a string
export async function spawn(
  command: string,
  args?: string[],
  opts?: ?SpawnOptions,
): Promise<string> {
  return spawnAdv(command, args, { rejectOnErrorCode: true, ...opts }).then(
    (r) => r.output,
  );
}

export type ExecOptions = {|
  cwd?: string,
  env?: Object,
  encoding?: string,
  shell?: string,
  timeout?: number,
  maxBuffer?: number,
  killSignal?: string | number,
  uid?: number,
  gid?: number,
  windowsHide?: boolean,
|};

export const exec = async (
  command: string,
  options?: ExecOptions,
): Promise<{ stdout: string | Buffer, stderr: string | Buffer }> =>
  new Promise((resolve, reject) => {
    cp.exec(command, options, (err, stdout, stderr) => {
      if (err) {
        reject(err);
        return;
      }

      resolve({ stdout, stderr });
    });
  });

export const onKillSignal = (cbFn: () => any) => {
  ['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, cbFn));
};
