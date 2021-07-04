// @flow
import throttle from 'lodash/throttle';
import { spawn } from './cp';

type DockerVolumeInspectOutput = {
  [string]: any,
};

export type DockerVolume = {|
  name: string,
  driver: string,
  scope: string,
  labels: string[],
  mountPoint: string,
  inspect: () => Promise<DockerVolumeInspectOutput>,
  rm: () => Promise<void>,
|};

type DockerVolumeLsOptions = {
  filter?: (vol: DockerVolume) => boolean,
};

// calling this function in rapid succession can lead to errors.
// prefer throttled version
export async function _dockerVolumeLs({
  filter,
}: DockerVolumeLsOptions = {}): Promise<DockerVolume[]> {
  return (
    await spawn('docker', ['volume', 'ls', '--format', '{{json .}}'], {
      captureOutput: true,
    })
  )
    .split('\n')
    .filter((line) => !!line.trim())
    .map((line) => {
      const {
        Name: name,
        Driver: driver,
        Scope: scope,
        Labels,
        Mountpoint: mountPoint,
      } = JSON.parse(line.trim());

      return {
        name,
        driver,
        scope,
        labels: Labels.split(',').map((l) => l.trim()),
        mountPoint,
        inspect: async () => (await dockerVolumeInspect(name))[0],
        rm: async () => dockerVolumeRm(name),
      };
    })
    .filter((v) => v.name && (typeof filter === 'function' ? filter(v) : true));
}

export const dockerVolumeLs: (
  DockerVolumeLsOptions | void,
) => Promise<DockerVolume[]> = throttle(_dockerVolumeLs, 500, {
  trailing: false,
});

export async function dockerVolumeFind(
  search: string,
  options?: DockerVolumeLsOptions,
): Promise<?DockerVolume> {
  return (await dockerVolumeLs(options)).find(
    (v) => v.name === search || v.name.startsWith(search),
  );
}

export type DockerVolumeCreateOptions = {|
  labels?: string[],
  driver?: string,
  driverOpts?: { [string]: string },
|};
export async function dockerVolumeCreate(
  name: string,
  { labels = [], driver, driverOpts = {} }: DockerVolumeCreateOptions = {},
): Promise<?DockerVolume> {
  const existing = await dockerVolumeFind(name);
  if (existing) return existing;
  await spawn('docker', [
    'volume',
    'create',
    ...labels.flatMap((l) => ['--label', l]),
    ...(driver ? ['-d', driver] : []),
    ...Object.entries(driverOpts).flatMap(([k, v]) => [
      '-o',
      `${k}=${(v: any)}`,
    ]),
    name,
  ]);
  return dockerVolumeFind(name);
}

export async function dockerVolumeRm(
  id: string | string[],
  ignoreErrors: boolean = true,
) {
  const ids = Array.isArray(id) ? id : [id];
  try {
    await spawn('docker', ['volume', 'rm', ...ids]);
  } catch (e) {
    if (!ignoreErrors) {
      throw new Error(`Failed to remove volume(s): ${e.message}`);
    }
  }
}

// calling this function in rapid succession can lead to errors.
// prefer throttled version
export async function _dockerVolumeInspect(
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
      ).trim(),
    ) || []
  );
}

export const dockerVolumeInspect: (
  string | string[],
) => Promise<DockerVolumeInspectOutput[]> = throttle(
  _dockerVolumeInspect,
  500,
  { trailing: true },
);
