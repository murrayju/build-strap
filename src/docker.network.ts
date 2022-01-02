import { throttle } from 'lodash-es';

import { spawn } from './cp.js';
import { parseDockerDate } from './docker.js';

export interface DockerNetwork {
  IPv6: boolean;
  created: Date;
  driver: string;
  exists: () => Promise<boolean>;
  id: string;
  labels: string[];
  name: string;
  rm: () => Promise<void>;
  scope: string;
}

interface DockerNetworkLsOptions {
  filter?: (network: DockerNetwork) => boolean;
}

interface DockerNetworkLsOutput {
  CreatedAt: string;
  Driver: string;
  ID: string;
  IPv6: string;
  Labels: string;
  Name: string;
  Scope: string;
}

// calling this function in rapid succession can lead to errors.
// prefer throttled version
export async function unthrottledDockerNetworkLs({
  filter,
}: DockerNetworkLsOptions = {}): Promise<DockerNetwork[]> {
  return (
    await spawn('docker', ['network', 'ls', '--format', '{{json .}}'], {
      captureOutput: true,
    })
  ).output
    .split('\n')
    .filter((line) => !!line.trim())
    .map((line) => {
      const {
        CreatedAt,
        Driver: driver,
        ID: id,
        IPv6,
        Labels,
        Name: name,
        Scope: scope,
      } = JSON.parse(line.trim()) as DockerNetworkLsOutput;

      return {
        IPv6: IPv6 === 'true',
        created: parseDockerDate(CreatedAt),
        driver,
        exists: async () => !!(await dockerNetworkFind(id)),
        id,
        labels: Labels.split(',').map((l) => l.trim()),
        name,
        rm: async () => dockerNetworkRm(id),
        scope,
      } as DockerNetwork;
    })
    .filter((n) => n.id && (typeof filter === 'function' ? filter(n) : true));
}

export const dockerNetworkLs: (
  options?: DockerNetworkLsOptions,
) => Promise<DockerNetwork[]> | undefined = throttle(
  unthrottledDockerNetworkLs,
  500,
  {
    trailing: false,
  },
);

export async function dockerNetworkFind(
  networkName: string,
  options?: DockerNetworkLsOptions,
): Promise<DockerNetwork | null> {
  return (
    (await dockerNetworkLs(options))?.find(
      (n) => n.name === networkName || n.id === networkName,
    ) || null
  );
}

export interface DockerNetworkCreateOptions {
  auxAddresses?: string[];
  driver?: string;
  driverOpts?: Record<string, string>;
  gateways?: string[];
  ingress?: boolean;
  internal?: boolean;
  ipRange?: string;
  ipv6?: boolean;
  labels?: string[];
  subnets?: string[];
}

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
): Promise<DockerNetwork | null> {
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
    ...Object.entries(driverOpts).flatMap(([k, v]) => ['-o', `${k}=${v}`]),
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
  alias?: string | null,
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
