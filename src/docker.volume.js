// @flow
import { spawn } from './cp';

export type DockerVolume = {
  name: string,
  driver: string,
  scope: string,
  labels: string[],
  mountPoint: string,
};

type DockerVolumeLsOptions = {
  filter?: (vol: DockerVolume) => boolean,
};
export async function dockerVolumeLs({
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
    .filter((v) => v.id && (typeof filter === 'function' ? filter(v) : true));
}

export async function dockerVolumeFind(
  search: string,
  options?: DockerVolumeLsOptions,
) {
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
) {
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

export async function dockerVolumeInspect(
  id: string | string[],
): Promise<Array<{ [string]: any }>> {
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
