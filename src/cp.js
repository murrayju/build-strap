// @flow
import cp from 'child_process';
import { buildLog } from './run';

export type SpawnOptions = {|
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

export async function spawn(
  command: string,
  args?: string[],
  options?: ?SpawnOptions,
  pipeOutput: boolean = false,
  captureOutput: boolean = false,
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const toStr = () => `${command}${args ? ` ${args.join(' ')}` : ''}`;
      const p = cp.spawn(command, args, {
        ...options,
        // $FlowFixMe
        ...(pipeOutput && !captureOutput && !(options && options.stdio)
          ? { stdio: 'inherit' }
          : {}),
      });

      let output = '';
      if (captureOutput) {
        if (p.stdout) {
          if (pipeOutput) {
            p.stdout.pipe(process.stdout);
          }
          p.stdout.on('data', (d) => {
            output += d.toString();
          });
        } else {
          buildLog(`Warning: cannot capture stdout for \`${toStr()}\``);
        }
        if (p.stderr) {
          if (pipeOutput) {
            p.stderr.pipe(process.stderr);
          }
          p.stderr.on('data', (d) => {
            output += d.toString();
          });
        } else {
          buildLog(`Warning: cannot capture stderr for \`${toStr()}\``);
        }
      }

      p.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`${toStr()} => ${code} (error)`));
        }
      });

      p.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`${toStr()} => ${code} (error)`));
        }
      });

      p.on('error', (err) => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
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
