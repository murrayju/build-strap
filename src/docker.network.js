// @flow
import throttle from 'lodash/throttle';
import { spawn } from './cp';
import { parseDockerDate } from './docker';

export type DockerNetwork = {|
  id: string,
  name: string,
  driver: string,
  scope: string,
  created: Date,
  IPv6: boolean,
  labels: string[],
  exists: () => Promise<boolean>,
  rm: () => Promise<void>,
|};

type DockerNetworkLsOptions = {
  filter?: (network: DockerNetwork) => boolean,
};

// calling this function in rapid succession can lead to errors.
// prefer throttled version
export async function _dockerNetworkLs({
  filter,
}: DockerNetworkLsOptions = {}): Promise<DockerNetwork[]> {
  return (
    await spawn('docker', ['network', 'ls', '--format', '{{json .}}'], {
      captureOutput: true,
    })
  )
    .split('\n')
    .filter((line) => !!line.trim())
    .map((line) => {
      const {
        ID: id,
        Name: name,
        Driver: driver,
        Scope: scope,
        CreatedAt,
        IPv6,
        Labels,
      } = JSON.parse(line.trim());
      return {
        id,
        name,
        driver,
        scope,
        created: parseDockerDate(CreatedAt),
        IPv6: IPv6 === 'true',
        labels: Labels.split(',').map((l) => l.trim()),
        exists: async () => !!(await dockerNetworkFind(id)),
        rm: async () => dockerNetworkRm(id),
      };
    })
    .filter((n) => n.id && (typeof filter === 'function' ? filter(n) : true));
}
export const dockerNetworkLs: (
  DockerNetworkLsOptions | void,
) => Promise<DockerNetwork[]> = throttle(_dockerNetworkLs, 500, {
  trailing: false,
});

export async function dockerNetworkFind(
  networkName: string,
  options?: DockerNetworkLsOptions,
): Promise<?DockerNetwork> {
  return (await dockerNetworkLs(options)).find(
    (n) => n.name === networkName || n.id === networkName,
  );
}

export type DockerNetworkCreateOptions = {|
  driver?: string,
  driverOpts?: { [string]: string },
  ipRange?: string,
  gateways?: string[],
  subnets?: string[],
  auxAddresses?: string[],
  ingress?: boolean,
  internal?: boolean,
  ipv6?: boolean,
  labels?: string[],
|};

export async function dockerNetworkCreate(
  networkName: string,
  {
    driver,
    driverOpts = {},
    ipRange,
    gateways = [],
    subnets = [],
    auxAddresses = [],
    ingress,
    internal,
    ipv6,
    labels = [],
  }: DockerNetworkCreateOptions = {},
): Promise<?DockerNetwork> {
  const existing = await dockerNetworkFind(networkName);
  if (existing) return existing;
  await spawn('docker', [
    'network',
    'create',
    ...labels.flatMap((l) => ['--label', l]),
    ...gateways.flatMap((g) => ['--gateway', g]),
    ...subnets.flatMap((s) => ['--subnet', s]),
    ...auxAddresses.flatMap((a) => ['--aux-address', a]),
    ...(ipRange ? ['--ip-range', ipRange] : []),
    ...(ingress ? ['--ingress'] : []),
    ...(internal ? ['--internal'] : []),
    ...(ipv6 ? ['--ipv6'] : []),
    ...(driver ? ['-d', driver] : []),
    ...Object.entries(driverOpts).flatMap(([k, v]) => [
      '-o',
      `${k}=${(v: any)}`,
    ]),
    networkName,
  ]);
  return dockerNetworkFind(networkName);
}

/**
 * Removes a network by id
 * @param {string} id The id of the network
 */
export async function dockerNetworkRm(id: string) {
  await spawn('docker', ['network', 'rm', id]);
}

/**
 * Removes all networks with the given name
 * @param {string} networkName The name of the network
 */
export async function dockerNetworkDelete(networkName: string) {
  let existing;
  // eslint-disable-next-line no-cond-assign, no-await-in-loop
  while ((existing = await dockerNetworkFind(networkName))) {
    // eslint-disable-next-line no-await-in-loop
    await existing.rm();
  }
}

export async function dockerNetworkConnect(
  networkName: string,
  containerId: string,
  alias?: ?string,
) {
  const net = await dockerNetworkCreate(networkName);
  if (!net) throw new Error('Failed to create docker network');
  await spawn('docker', [
    'network',
    'connect',
    ...(alias ? ['--alias', alias] : []),
    net.id,
    containerId,
  ]);
}
