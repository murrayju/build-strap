// @flow
import bytes from 'bytes';
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
  start: () => Promise<void>,
  stop: (ignoreError?: boolean) => Promise<void>,
  kill: (ignoreError?: boolean) => Promise<void>,
  restart: () => Promise<void>,
  rm: (ignoreError?: boolean) => Promise<void>,
|};

type DockerContainerLsOptions = {
  all?: boolean,
  filter?: (container: DockerContainer) => boolean,
};

export async function dockerContainerLs({
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
        start: async () => dockerContainerStart(id),
        stop: async (ignoreError?: boolean = true) =>
          dockerContainerStop(id, ignoreError),
        kill: async (ignoreError?: boolean = true) =>
          dockerContainerKill(id, ignoreError),
        restart: async () => dockerContainerRestart(id),
        rm: async (ignoreError?: boolean = true) =>
          dockerContainerRm(id, ignoreError),
      };
    })
    .filter((c) => c.id && (typeof filter === 'function' ? filter(c) : true));
}

export async function dockerContainerFind(
  search: string,
  options?: DockerContainerLsOptions,
) {
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

export async function dockerContainerInspect(
  id: string | string[],
): Promise<DockerContainerInspectOutput[]> {
  const ids = Array.isArray(id) ? id : [id];
  return (
    JSON.parse(
      (
        await spawn(
          'docker',
          ['container', 'inspect', '--format', '{{json .}}', ...ids],
          { captureOutput: true },
        )
      ).trim(),
    ) || []
  );
}

type DockerContainerRunDaemonArgs = {|
  image: string,
  runArgs?: string[],
  cmd?: string[],
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
}: DockerContainerRunArgs) {
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
  const container = await dockerContainerFind(id);
  if (!container) {
    throw new Error(`Failed to find newly created container: ${id}`);
  }
  return container;
}
