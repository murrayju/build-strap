import { throttle } from 'lodash-es';

import { spawn } from './cp.js';

type DockerVolumeInspectOutput = Record<string, unknown>;

export interface DockerVolume {
  driver: string;
  inspect: () => Promise<null | DockerVolumeInspectOutput>;
  labels: string[];
  mountPoint: string;
  name: string;
  rm: () => Promise<void>;
  scope: string;
}

interface DockerVolumeLsOptions {
  filter?: (vol: DockerVolume) => boolean;
}

interface DockerVolumeLsOutput {
  Driver: string;
  Labels: string;
  Mountpoint: string;
  Name: string;
  Scope: string;
}

// calling this function in rapid succession can lead to errors.
// prefer throttled version
export async function unthrottledDockerVolumeLs({
  filter,
}: DockerVolumeLsOptions = {}): Promise<DockerVolume[]> {
  return (
    await spawn('docker', ['volume', 'ls', '--format', '{{json .}}'], {
      captureOutput: true,
    })
  ).output
    .split('\n')
    .filter((line) => !!line.trim())
    .map((line) => {
      const {
        Driver: driver,
        Labels,
        Mountpoint: mountPoint,
        Name: name,
        Scope: scope,
      } = JSON.parse(line.trim()) as DockerVolumeLsOutput;

      return {
        driver,
        inspect: async () => (await dockerVolumeInspect(name))?.[0] || null,
        labels: Labels.split(',').map((l) => l.trim()),
        mountPoint,
        name,
        rm: async () => dockerVolumeRm(name),
        scope,
      };
    })
    .filter((v) => v.name && (typeof filter === 'function' ? filter(v) : true));
}

export const dockerVolumeLs: (
  options?: DockerVolumeLsOptions,
) => undefined | Promise<DockerVolume[]> = throttle(
  unthrottledDockerVolumeLs,
  500,
  {
    trailing: false,
  },
);

export async function dockerVolumeFind(
  search: string,
  options?: DockerVolumeLsOptions,
): Promise<null | DockerVolume> {
  return (
    (await dockerVolumeLs(options))?.find(
      (v) => v.name === search || v.name.startsWith(search),
    ) ?? null
  );
}

export interface DockerVolumeCreateOptions {
  driver?: string;
  driverOpts?: Record<string, string>;
  labels?: string[];
}
export async function dockerVolumeCreate(
  name: string,
  { driver, driverOpts = {}, labels = [] }: DockerVolumeCreateOptions = {},
): Promise<null | DockerVolume> {
  const existing = await dockerVolumeFind(name);
  if (existing) return existing;
  await spawn('docker', [
    'volume',
    'create',
    ...labels.flatMap((l) => ['--label', l]),
    ...(driver ? ['-d', driver] : []),
    ...Object.entries(driverOpts).flatMap(([k, v]) => ['-o', `${k}=${v}`]),
    name,
  ]);
  return dockerVolumeFind(name);
}

export async function dockerVolumeRm(
  id: string | string[],
  ignoreErrors = true,
) {
  const ids = Array.isArray(id) ? id : [id];
  try {
    await spawn('docker', ['volume', 'rm', ...ids]);
  } catch (e) {
    if (!ignoreErrors) {
      throw new Error(
        `Failed to remove volume(s): ${e instanceof Error && e.message}`,
      );
    }
  }
}

// calling this function in rapid succession can lead to errors.
// prefer throttled version
export async function unthrottledDockerVolumeInspect(
  id: string | string[],
): Promise<DockerVolumeInspectOutput[]> {
  const ids = Array.isArray(id) ? id : [id];
  return (
    JSON.parse(
      (
        await spawn(
          'docker',
          ['volume', 'inspect', '--format', '{{json .}}', ...ids],
          { captureOutput: true },
        )
      ).output.trim(),
    ) || []
  );
}

export const dockerVolumeInspect: (
  id: string | string[],
) => undefined | Promise<DockerVolumeInspectOutput[]> = throttle(
  unthrottledDockerVolumeInspect,
  500,
  { trailing: true },
);
