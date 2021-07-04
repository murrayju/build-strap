// @flow
import bytes from 'bytes';
import throttle from 'lodash/throttle';
import { buildLog } from './run';
import { spawn } from './cp';
import type { SpawnOptions } from './cp';
import { parseDockerDate } from './docker';

type DockerContainerInspectOutput = {
  [string]: any,
};

export type DockerContainer = {|
  command: string,
  created: Date,
  id: string,
  image: string,
  labels: string[],
  mounts: string[],
  name: string,
  names: string[],
  networks: string[],
  ports: Array<{ iface: string, sourcePort: number, destPort: number }>,
  runningFor: string,
  size: string,
  status: string,
  exited: boolean,
  inspect: () => Promise<DockerContainerInspectOutput>,
  exists: () => Promise<boolean>,
  isRunning: () => Promise<boolean>,
  start: () => Promise<void>,
  stop: (ignoreError?: boolean) => Promise<void>,
  kill: (ignoreError?: boolean) => Promise<void>,
  restart: () => Promise<void>,
  rm: (ignoreError?: boolean) => Promise<void>,
  teardown: (verbose?: boolean) => Promise<void>,
|};

type DockerContainerLsOptions = {
  all?: boolean,
  filter?: (container: DockerContainer) => boolean,
};

// calling this function in rapid succession can lead to errors.
// prefer throttled version
export async function _dockerContainerLs({
  all,
  filter,
}: DockerContainerLsOptions = {}): Promise<DockerContainer[]> {
  return (
    await spawn(
      'docker',
      [
        'container',
        'ls',
        ...(all ? ['--all'] : []),
        '--no-trunc',
        '--format',
        '{{json .}}',
      ],
      { captureOutput: true },
    )
  )
    .split('\n')
    .filter((line) => !!line.trim())
    .map((line) => {
      const {
        Command: command,
        CreatedAt,
        ID: id,
        Image: image,
        Labels,
        Mounts,
        Names,
        Networks,
        Ports,
        RunningFor: runningFor,
        Size,
        Status: status,
      } = JSON.parse(line.trim());
      const names = Names.split(',').map((n) => n.trim());
      const [name] = names;

      return {
        command,
        id,
        image,
        name,
        names,
        runningFor,
        size: bytes.parse(Size),
        status,
        created: parseDockerDate(CreatedAt),
        labels: Labels.split(',').map((l) => l.trim()),
        mounts: Mounts.split(',').map((m) => m.trim()),
        networks: Networks.split(',').map((n) => n.trim()),
        ports: Ports.split(',').map((p) => {
          const [, iface, src, dest] =
            p.match(/^([^:]+):(\d+)-\\u003e(\d+)/i) || [];
          return {
            iface,
            src: parseInt(src, 10),
            dest: parseInt(dest, 10),
          };
        }),
        exited: /^Exited/.test(status),
        inspect: async () => (await dockerContainerInspect(id))[0],
        async exists(): Promise<boolean> {
          try {
            return !!(await this.inspect());
          } catch {
            return false;
          }
        },
        async isRunning(): Promise<boolean> {
          try {
            const {
              State: { Running: running },
            } = await this.inspect();
            return running;
          } catch {
            return false;
          }
        },
        start: async () => dockerContainerStart(id),
        stop: async (ignoreError?: boolean = true) =>
          dockerContainerStop(id, ignoreError),
        kill: async (ignoreError?: boolean = true) =>
          dockerContainerKill(id, ignoreError),
        restart: async () => dockerContainerRestart(id),
        rm: async (ignoreError?: boolean = true) =>
          dockerContainerRm(id, ignoreError),
        async teardown(verbose?: boolean = true) {
          const log = (msg) => verbose && buildLog(msg);
          if (await this.isRunning()) {
            try {
              log(`Stopping container: <${this.name}>...`);
              await this.stop(false);
              log(`<${this.name}> container stopped.`);
            } catch (e1) {
              log(`Failed to stop <${this.name}> container: ${e1.message}`);
              try {
                log(`Killing container: <${this.name}>...`);
                await this.kill(false);
                log(`<${this.name}> container killed.`);
              } catch (e2) {
                log(`Failed to kill <${this.name}> container: ${e2.message}`);
              }
            }
          } else {
            log(`<${this.name}> container not running, skipping stop.`);
          }
          if (await this.exists()) {
            await this.rm(true);
          } else {
            log(`<${this.name}> container does not exist, skipping rm.`);
          }
        },
      };
    })
    .filter((c) => c.id && (typeof filter === 'function' ? filter(c) : true));
}

export const dockerContainerLs: (
  DockerContainerLsOptions | void,
) => Promise<DockerContainer[]> = throttle(_dockerContainerLs, 500, {
  trailing: false,
});

export async function dockerContainerFind(
  search: string,
  options?: DockerContainerLsOptions,
): Promise<?DockerContainer> {
  return (
    (await dockerContainerLs(options)).find(
      (c) =>
        c.name === search ||
        c.id.startsWith(search) ||
        c.names.includes(search),
    ) || null
  );
}

export async function dockerContainerStop(
  id: string | string[],
  ignoreErrors: boolean = true,
) {
  const ids = Array.isArray(id) ? id : [id];
  try {
    await spawn('docker', ['container', 'stop', ...ids]);
  } catch (e) {
    if (!ignoreErrors) {
      throw new Error(`Failed to stop container(s): ${e.message}`);
    }
  }
}

export async function dockerContainerKill(
  id: string | string[],
  ignoreErrors: boolean = true,
) {
  const ids = Array.isArray(id) ? id : [id];
  try {
    await spawn('docker', ['container', 'kill', ...ids]);
  } catch (e) {
    if (!ignoreErrors) {
      throw new Error(`Failed to kill container(s): ${e.message}`);
    }
  }
}

export async function dockerTryStopContainer(id: ?string, name?: string = '') {
  if (id) {
    try {
      await dockerContainerStop(id, false);
    } catch (e) {
      buildLog(`Failed to stop ${name} container: ${e.message}`);
    }
  }
}

export async function dockerContainerRm(
  id: string | string[],
  ignoreErrors: boolean = true,
) {
  const ids = Array.isArray(id) ? id : [id];
  try {
    await spawn('docker', ['container', 'rm', ...ids]);
  } catch (e) {
    if (ignoreErrors) {
      buildLog(
        `Warning (ignored Error): Failed to remove container(s): ${e.message}`,
      );
    } else {
      throw new Error(`Failed to remove container(s): ${e.message}`);
    }
  }
}

export async function dockerContainerRestart(id: string | string[]) {
  const ids = Array.isArray(id) ? id : [id];
  await spawn('docker', ['container', 'restart', ...ids]);
}

export async function dockerContainerStart(id: string | string[]) {
  const ids = Array.isArray(id) ? id : [id];
  await spawn('docker', ['container', 'start', ...ids]);
}

export async function _dockerContainerInspect(
  id: string | string[],
): Promise<DockerContainerInspectOutput[]> {
  const ids = Array.isArray(id) ? id : [id];
  return (
    (
      await spawn(
        'docker',
        ['container', 'inspect', '--format', '{{json .}}', ...ids],
        { captureOutput: true },
      )
    )
      .split('\n')
      .filter((line) => !!line.trim())
      .map((line) => JSON.parse(line.trim())) || []
  );
}
export const dockerContainerInspect: (
  string | string[],
) => Promise<DockerContainerInspectOutput[]> = throttle(
  _dockerContainerInspect,
  500,
  {
    trailing: false,
  },
);

type DockerContainerRunDaemonArgs = {|
  image: string,
  runArgs?: string[],
  cmd?: string[],
  waitAttempts?: number,
  waitDuration?: number,
|};

type DockerContainerRunArgs = {|
  ...DockerContainerRunDaemonArgs,
  spawnOptions?: ?SpawnOptions,
|};

export async function dockerContainerRun({
  image,
  runArgs = [],
  cmd = [],
  spawnOptions,
}: DockerContainerRunArgs): Promise<string> {
  return spawn('docker', ['container', 'run', ...runArgs, image, ...cmd], {
    stdio: 'inherit',
    pipeOutput: true,
    ...spawnOptions,
  });
}

export async function dockerContainerRunDaemon({
  image,
  runArgs = [],
  cmd = [],
  waitAttempts = 10,
  waitDuration = 501,
}: DockerContainerRunDaemonArgs): Promise<DockerContainer> {
  const id = (
    await dockerContainerRun({
      image,
      cmd,
      runArgs: ['-d', ...runArgs],
      spawnOptions: {
        stdio: 'pipe',
        pipeOutput: false,
        captureOutput: true,
      },
    })
  ).trim();
  let container = await dockerContainerFind(id);
  let attempts = 0;

  // containers don't always show up in the list right away
  /* eslint-disable no-await-in-loop */
  while (!container && attempts < waitAttempts) {
    await new Promise((resolve) => setTimeout(resolve, waitDuration));
    container = await dockerContainerFind(id);
    attempts += 1;
  }
  /* eslint-enable no-await-in-loop */

  if (!container) {
    throw new Error(`Failed to find newly created container: ${id}`);
  }
  return container;
}

const indicators = ['.', ':', '*', '+', '-', '=', '%', '$', '@', '^', '&'];
let curIndicator = 0;

/**
 * Waits for the given container to be fully started. Checks that the container is
 * running, and test with the provided testFn every second until it returns true.
 * @param {DockerContainer} container The container to test
 * @param {Function} testFn A function that validates that the container is ready (e.g. by calling an API on the container)
 * @param {number} timeoutMs The amount of time to wait between attempts.
 * @param {number} maxAttempts The maximum number of attempts before giving up (rejects promise)
 */
export const dockerContainerWaitForStart = async (
  container: DockerContainer,
  testFn: (DockerContainer) => Promise<boolean>,
  timeoutMs?: number = 1000,
  maxAttempts?: number = 1200,
) => {
  // claim an indicator
  const indicator = indicators[curIndicator] || '.';
  curIndicator = (curIndicator + 1) % indicators.length;

  const { name } = container;
  buildLog(`Waiting for ${name} to fully start... ${indicator}`);
  await new Promise((resolve, reject) => {
    const check = (tries = 0) => {
      process.stdout.write(indicator);
      setTimeout(async () => {
        try {
          if (!(await container.isRunning())) {
            return reject(
              new Error(`The '${name}' container is no longer running.`),
            );
          }
          if (await testFn(container)) {
            return resolve();
          }
        } catch (err) {
          // ignore
        }
        return tries < maxAttempts
          ? check(tries + 1)
          : reject(
              new Error(`Timeout waiting for '${name}' container to start.`),
            );
      }, timeoutMs);
    };
    check();
  });
  process.stdout.write('\n');
};
