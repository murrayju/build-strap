import bytes from 'bytes';
import { throttle } from 'lodash-es';

import { spawn, SpawnOptions } from './cp.js';
import { parseDockerDate } from './docker.js';
import { buildLog } from './run.js';

interface DockerContainerInspectOutput {
  State: {
    Running: boolean;
  };
}

interface Port {
  dest: number;
  iface: string;
  src: number;
}

export interface DockerContainer {
  command: string;
  created: Date;
  exists: () => Promise<boolean>;
  exited: boolean;
  id: string;
  image: string;
  inspect: () => Promise<DockerContainerInspectOutput | undefined>;
  isRunning: () => Promise<boolean>;
  kill: (ignoreError?: boolean) => Promise<void>;
  labels: string[];
  mounts: string[];
  name: string;
  names: string[];
  networks: string[];
  ports: Port[];
  restart: () => Promise<void>;
  rm: (ignoreError?: boolean) => Promise<void>;
  runningFor: string;
  size: number;
  start: () => Promise<void>;
  status: string;
  stop: (ignoreError?: boolean) => Promise<void>;
  teardown: (verbose?: boolean) => Promise<void>;
}

interface DockerContainerLsOptions {
  all?: boolean;
  filter?: (container: DockerContainer) => boolean;
}

interface DockerContainerLsOutput {
  Command: string;
  CreatedAt: string;
  ID: string;
  Image: string;
  Labels: string;
  Mounts: string;
  Names: string;
  Networks: string;
  Ports: string;
  RunningFor: string;
  Size: string;
  Status: string;
}

// calling this function in rapid succession can lead to errors.
// prefer throttled version
export async function unthrottledDockerContainerLs({
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
  ).output
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
      } = JSON.parse(line.trim()) as DockerContainerLsOutput;
      const names = Names.split(',').map((n) => n.trim());
      const [name] = names;

      return {
        command,
        created: parseDockerDate(CreatedAt),
        async exists(): Promise<boolean> {
          try {
            return !!(await this.inspect());
          } catch {
            return false;
          }
        },
        exited: /^Exited/.test(status),
        id,
        image,
        inspect: async () => (await dockerContainerInspect(id))?.[0],
        async isRunning(): Promise<boolean> {
          try {
            return (await this.inspect())?.State?.Running || false;
          } catch {
            return false;
          }
        },
        kill: async (ignoreError = true) =>
          dockerContainerKill(id, ignoreError),
        labels: Labels.split(',').map((l) => l.trim()),
        mounts: Mounts.split(',').map((m) => m.trim()),
        name,
        names,
        networks: Networks.split(',').map((n) => n.trim()),
        ports: Ports.split(',').map((p) => {
          const [, iface, src, dest] =
            p.match(/^([^:]+):(\d+)-\\u003e(\d+)/i) || [];
          return {
            dest: parseInt(dest, 10),
            iface,
            src: parseInt(src, 10),
          } as Port;
        }),
        restart: async () => dockerContainerRestart(id),
        rm: async (ignoreError = true) => dockerContainerRm(id, ignoreError),
        runningFor,
        size: bytes.parse(Size),
        start: async () => dockerContainerStart(id),
        status,
        stop: async (ignoreError = true) =>
          dockerContainerStop(id, ignoreError),
        async teardown(verbose = true) {
          const log = (msg: string) => verbose && buildLog(msg);
          if (await this.isRunning()) {
            try {
              log(`Stopping container: <${this.name}>...`);
              await this.stop(false);
              log(`<${this.name}> container stopped.`);
            } catch (e1) {
              log(
                `Failed to stop <${this.name}> container: ${
                  e1 instanceof Error && e1.message
                }`,
              );
              try {
                log(`Killing container: <${this.name}>...`);
                await this.kill(false);
                log(`<${this.name}> container killed.`);
              } catch (e2) {
                log(
                  `Failed to kill <${this.name}> container: ${
                    e2 instanceof Error && e2.message
                  }`,
                );
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
      } as DockerContainer;
    })
    .filter((c) => c.id && (typeof filter === 'function' ? filter(c) : true));
}

export const dockerContainerLs: (
  options: DockerContainerLsOptions | undefined,
) => Promise<DockerContainer[]> | undefined = throttle(
  unthrottledDockerContainerLs,
  500,
  {
    trailing: false,
  },
);

export async function dockerContainerFind(
  search: string,
  options?: DockerContainerLsOptions,
): Promise<DockerContainer | null> {
  return (
    (await dockerContainerLs(options))?.find(
      (c) =>
        c.name === search ||
        c.id.startsWith(search) ||
        c.names.includes(search),
    ) || null
  );
}

export async function dockerContainerStop(
  id: string | string[],
  ignoreErrors = true,
) {
  const ids = Array.isArray(id) ? id : [id];
  try {
    await spawn('docker', ['container', 'stop', ...ids]);
  } catch (e) {
    if (!ignoreErrors) {
      throw new Error(
        `Failed to stop container(s): ${e instanceof Error && e.message}`,
      );
    }
  }
}

export async function dockerContainerKill(
  id: string | string[],
  ignoreErrors = true,
) {
  const ids = Array.isArray(id) ? id : [id];
  try {
    await spawn('docker', ['container', 'kill', ...ids]);
  } catch (e) {
    if (!ignoreErrors) {
      throw new Error(
        `Failed to kill container(s): ${e instanceof Error && e.message}`,
      );
    }
  }
}

export async function dockerTryStopContainer(id: string | null, name = '') {
  if (id) {
    try {
      await dockerContainerStop(id, false);
    } catch (e) {
      buildLog(
        `Failed to stop ${name} container: ${e instanceof Error && e.message}`,
      );
    }
  }
}

export async function dockerContainerRm(
  id: string | string[],
  ignoreErrors = true,
) {
  const ids = Array.isArray(id) ? id : [id];
  try {
    await spawn('docker', ['container', 'rm', ...ids]);
  } catch (e) {
    if (ignoreErrors) {
      buildLog(
        `Warning (ignored Error): Failed to remove container(s): ${
          e instanceof Error && e.message
        }`,
      );
    } else {
      throw new Error(
        `Failed to remove container(s): ${e instanceof Error && e.message}`,
      );
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

export async function unthrottledDockerContainerInspect(
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
    ).output
      .split('\n')
      .filter((line) => !!line.trim())
      .map((line) => JSON.parse(line.trim())) || []
  );
}
export const dockerContainerInspect: (
  id: string | string[],
) => Promise<DockerContainerInspectOutput[]> | undefined = throttle(
  unthrottledDockerContainerInspect,
  500,
  {
    trailing: false,
  },
);

interface DockerContainerRunDaemonArgs {
  cmd?: string[];
  image: string;
  runArgs?: string[];
  waitAttempts?: number;
  waitDuration?: number;
}

interface DockerContainerRunArgs extends DockerContainerRunDaemonArgs {
  spawnOptions?: SpawnOptions | null;
}

export async function dockerContainerRun({
  image,
  runArgs = [],
  cmd = [],
  spawnOptions,
}: DockerContainerRunArgs): Promise<string> {
  return (
    await spawn('docker', ['container', 'run', ...runArgs, image, ...cmd], {
      pipeOutput: true,
      stdio: 'inherit',
      ...spawnOptions,
    })
  ).output;
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
      cmd,
      image,
      runArgs: ['-d', ...runArgs],
      spawnOptions: {
        captureOutput: true,
        pipeOutput: false,
        stdio: 'pipe',
      },
    })
  ).trim();
  let container = await dockerContainerFind(id);
  let attempts = 0;

  // containers don't always show up in the list right away
  /* eslint-disable no-await-in-loop */
  while (!container && attempts < waitAttempts) {
    await new Promise((resolve) => {
      setTimeout(resolve, waitDuration);
    });
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
  testFn: (container: DockerContainer) => Promise<boolean>,
  timeoutMs = 1000,
  maxAttempts = 1200,
): Promise<void> => {
  // claim an indicator
  const indicator = indicators[curIndicator] || '.';
  curIndicator = (curIndicator + 1) % indicators.length;

  const { name } = container;
  buildLog(`Waiting for ${name} to fully start... ${indicator}`);
  await new Promise<void>((resolve, reject) => {
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
