// @flow
import fs from 'fs-extra';
import yaml from 'js-yaml';
import path from 'path';
import getPort from 'get-port';
import { keys, entries, mapValuesAsync, type MapObj } from './maps';

import { buildLog } from './run';
import { dockerPull } from './docker';
import {
  dockerContainerFind,
  dockerContainerRunDaemon,
  type DockerContainer,
} from './docker.container';
import {
  dockerNetworkDelete,
  dockerNetworkCreate,
  type DockerNetworkCreateOptions,
  type DockerNetwork,
} from './docker.network';
import {
  dockerVolumeCreate,
  dockerVolumeRm,
  type DockerVolume,
} from './docker.volume';

export type DockerComposeResourceTracker = {
  services: Map<string, DockerComposeService>,
  networks: Map<string, DockerNetwork>,
  containers: Map<string, DockerContainer>,
  volumes: Map<string, DockerVolume>,
  cleaning: ?Promise<void>,
};

export const dockerComposeCreateResourceTracker = (): DockerComposeResourceTracker => ({
  networks: new Map(),
  services: new Map(),
  containers: new Map(),
  volumes: new Map(),
  cleaning: null,
});

const defaultTracker = dockerComposeCreateResourceTracker();

type DockerComposeEnvDef = string[] | { [string]: string };

type DockerComposeULimitDef = number | { soft: number, hard: number };

type DockerComposeULimitsDef = {
  [string]: DockerComposeULimitDef,
};

type DockerComposeServiceDef = {
  container_name?: string,
  image?: string,
  ports?: string[],
  volumes?: string[],
  command?: string[],
  networks?: string[],
  environment?: DockerComposeEnvDef,
  links?: string[],
  ulimits?: DockerComposeULimitsDef,
};

type DockerComposeVolumeDef = {
  name?: string,
};

type DockerComposeNetworkDef = {
  ...DockerNetworkCreateOptions,
  name?: string,
};

type DockerCompose = {
  version: string,
  services?: {
    [string]: DockerComposeServiceDef,
  },
  volumes?: {
    [string]: DockerComposeVolumeDef,
  },
  networks?: {
    [string]: DockerComposeNetworkDef,
  },
};

/**
 * Parse a docker-compose.yml file into a pojo representation
 * @param {string} filePath Path to the docker-compose.yml file
 */
export const dockerComposeParse = async (
  filePath?: string = './docker-compose.yml',
): Promise<DockerCompose> => (yaml.load(await fs.readFile(filePath)): any);

let dc: ?DockerCompose = null;

/**
 * Get the main docker-compose.yml from the root of the repo
 * @param {boolean} force Force reload from file
 */
export const dockerComposeGetMain = async (
  force?: boolean = false,
): Promise<DockerCompose> => {
  if (force || !dc) {
    dc = await dockerComposeParse();
  }
  return dc;
};

// Function that handles passed dockerCompose as either a file path or `DockerCompose` object.
// If not passed, defaults to the main docker-compose.yml from the root of the repo
const dockerComposeResolve = async (
  dockerCompose?: ?(string | DockerCompose),
  force?: boolean,
): Promise<DockerCompose> =>
  typeof dockerCompose === 'string'
    ? dockerComposeParse(dockerCompose)
    : dockerCompose || dockerComposeGetMain(force);

// Determines an unnamed resource's name from the dirname combined with the key
const prefixName = (name: string) => `${path.basename(__dirname)}_${name}`;

const getServiceDef = async (
  name: string,
  force?: boolean,
  dockerCompose?: ?(string | DockerCompose),
): Promise<?DockerComposeServiceDef> =>
  (await dockerComposeResolve(dockerCompose, force)).services?.[name] || null;

type PortMap = {
  local: ?number,
  localDefault: number,
  docker: number,
};

type UrlMap = {
  local: ?string,
  docker: ?string,
};

type ParsedPortInfo = {
  runArgs: string[],
  ports: PortMap[],
};

const parsePorts = async (
  portsCfg?: string[] = [],
  avoidConflicts?: boolean = true,
  mapLocal?: boolean = true,
  host?: string = '0.0.0.0',
): Promise<ParsedPortInfo> => {
  const ports: PortMap[] = [];
  const runArgs = await portsCfg.reduce(async (args, portStr) => {
    const [lp, dp] = portStr.split(':');
    const localDefault = parseInt(lp, 10);
    const docker = parseInt(dp, 10);
    const local = mapLocal
      ? avoidConflicts
        ? await getPort({ port: localDefault, host })
        : localDefault
      : null;
    ports.push({ local, localDefault, docker });
    return local ? [...(await args), '-p', `${local}:${docker}`] : args;
  }, []);
  return { runArgs, ports };
};

const parseEnv = (env?: DockerComposeEnvDef = []): string[] =>
  Array.isArray(env)
    ? env.flatMap((e) => ['-e', e])
    : entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);

const parseULimits = (ul?: DockerComposeULimitsDef = {}): string[] =>
  entries(ul).flatMap(([k, v]) => [
    '--ulimit',
    `${k}=${
      typeof v === 'number' ? v : `${v.soft}${v.hard ? `:${v.hard}` : ''}`
    }`,
  ]);

type ParsedVolumeInfo = {
  runArgs: string[],
  volumes: string[],
};

const parseVolumes = async (
  volCfg?: string[] = [],
  nameSuffix?: string = '',
  dockerCompose?: ?(string | DockerCompose),
): Promise<ParsedVolumeInfo> => {
  const { volumes: volMap } = await dockerComposeResolve(dockerCompose);
  const volumes = [];
  const runArgs: string[] = volCfg
    .map((v) => {
      const [src, ...rest] = v.split(':');
      const name = volMap?.[src]
        ? `${volMap[src].name || prefixName(src)}${nameSuffix}`
        : null;
      if (name) {
        volumes.push(name);
      }
      const realSrc = name || path.resolve(src);
      return [realSrc, ...rest].join(':');
    })
    .flatMap((v) => ['-v', v]);
  return { runArgs, volumes };
};

type ParsedNetworkInfo = {
  runArgs: string[],
  networks: string[],
};

const parseNetworks = async (
  netCfg?: string[] = [],
  dockerCompose?: ?(string | DockerCompose),
): Promise<ParsedNetworkInfo> => {
  const { networks: netMap } = await dockerComposeResolve(dockerCompose);
  const networks = netCfg.map((n) => netMap?.[n].name || prefixName(n));
  return {
    networks,
    runArgs: (networks.flatMap((n) => ['--network', n]): string[]),
  };
};

export const dockerComposeCreateNetworks = async (
  names?: ?(string[]),
  dockerCompose?: ?(string | DockerCompose),
  tracker?: DockerComposeResourceTracker = defaultTracker,
) => {
  const { networks = {} } = await dockerComposeResolve(dockerCompose);
  await Promise.all(
    entries(networks).map(async ([key, val]) => {
      const name = val?.name || prefixName(key);
      if (!names || names.includes(name)) {
        const network = await dockerNetworkCreate(name, (val || {}: any));
        if (network) {
          tracker.networks.set(name, network);
        }
      }
    }),
  );
};

export const dockerComposeCreateVolumes = async (
  names?: string[],
  dockerCompose?: ?(string | DockerCompose),
  tracker?: DockerComposeResourceTracker = defaultTracker,
) => {
  const { volumes = {} } = await dockerComposeResolve(dockerCompose);
  await Promise.all(
    entries(volumes).map(async ([key, val]) => {
      const name = val?.name || prefixName(key);
      if (!names || names.includes(name)) {
        const volume = await dockerVolumeCreate(name, (val || {}: any));
        if (volume) {
          tracker.volumes.set(name, volume);
        }
      }
    }),
  );
};

type HealthCheckFn = (UpResult) => Promise<void>;

type UpOptions = {
  healthCheck?: HealthCheckFn,
  avoidConflicts?: boolean,
  mapVolumes?: boolean,
  mapPorts?: boolean,
  cmd?: string[],
  tracker?: DockerComposeResourceTracker,
};

type ServiceNameInfo = {
  name: string,
  aliases: string[],
  suffix: string,
};

type UpResult = {|
  service: DockerComposeService,
  container: DockerContainer,
  containerName: string,
  aliases: string[],
  ports: PortMap[],
  urls: UrlMap[],
  volumes: string[],
|};

export class DockerComposeService {
  #name: string;
  #svcDef: DockerComposeServiceDef;
  #dockerCompose: ?(DockerCompose | string);
  #tracker: DockerComposeResourceTracker = dockerComposeCreateResourceTracker();

  // lazily computed
  #parsedPorts: ?ParsedPortInfo = null;
  #parsedNetworks: ?ParsedNetworkInfo = null;
  #parsedVolumes: ?ParsedVolumeInfo = null;
  #baseRunArgs: ?(string[]) = null;

  constructor(
    name: string,
    serviceDef: DockerComposeServiceDef,
    dockerCompose?: ?(DockerCompose | string),
  ) {
    this.#name = name;
    this.#svcDef = serviceDef;
    this.#dockerCompose = dockerCompose || null;
  }

  get name(): string {
    return this.#name;
  }

  get serviceDef(): DockerComposeServiceDef {
    return this.#svcDef;
  }

  get image(): ?string {
    return this.#svcDef.image || null;
  }

  get defaultContainerName(): string {
    return this.#svcDef.container_name || this.#name;
  }

  get cmd(): string[] {
    return this.#svcDef.command || [];
  }

  get envArgs(): string[] {
    return parseEnv(this.#svcDef.environment);
  }

  /**
   * Find (available) container name and alias(es)
   * @param {boolean} avoidConflicts if `true`, find a container name that is unused
   * @param {number} max maximum number of names to try
   */
  async getNames(
    avoidConflicts?: boolean = false,
    max?: number = 100,
  ): Promise<ServiceNameInfo> {
    /* eslint-disable no-await-in-loop */
    for (let i = 0; i < max; i += 1) {
      const suffix = i ? `-${i}` : '';
      const testName = `${this.defaultContainerName}${suffix}`;
      const container = await dockerContainerFind(testName, { all: true });
      if (!avoidConflicts || !container) {
        return {
          name: testName,
          aliases: [`${this.name}${suffix}`],
          suffix,
        };
      }
    }
    /* eslint-enable no-await-in-loop */
    throw new Error(
      `Failed to find available container name for ${this.defaultContainerName}`,
    );
  }

  // Get (available) port mappings
  async getPorts(
    avoidConflicts?: boolean = false,
    mapLocal?: boolean = true,
  ): Promise<ParsedPortInfo> {
    return parsePorts(this.#svcDef.ports, avoidConflicts, mapLocal);
  }

  async getDefaultPortInfo(): Promise<ParsedPortInfo> {
    if (!this.#parsedPorts) {
      this.#parsedPorts = await this.getPorts();
    }
    return this.#parsedPorts;
  }

  async getDefaultPorts(): Promise<PortMap[]> {
    const { ports } = await this.getDefaultPortInfo();
    return ports;
  }

  async getDefaultPortArgs(): Promise<string[]> {
    const { runArgs } = await this.getDefaultPortInfo();
    return runArgs;
  }

  async getDefaultUrls(): Promise<UrlMap[]> {
    return this.constructor.getUrls(
      await this.getDefaultPorts(),
      this.defaultContainerName,
    );
  }

  async getDefaultNetworkInfo(): Promise<ParsedNetworkInfo> {
    if (!this.#parsedNetworks) {
      this.#parsedNetworks = await parseNetworks(this.#svcDef.networks);
    }
    return this.#parsedNetworks;
  }

  async getDefaultNetworks(): Promise<string[]> {
    const { networks } = await this.getDefaultNetworkInfo();
    return networks;
  }

  async getDefaultNetworkArgs(): Promise<string[]> {
    const { runArgs } = await this.getDefaultNetworkInfo();
    return runArgs;
  }

  async getDefaultVolumeInfo(): Promise<ParsedVolumeInfo> {
    if (!this.#parsedVolumes) {
      this.#parsedVolumes = await parseVolumes(this.#svcDef.networks);
    }
    return this.#parsedVolumes;
  }

  async getDefaultVolumes(): Promise<string[]> {
    const { volumes } = await this.getDefaultVolumeInfo();
    return volumes;
  }

  async getDefaultVolumeArgs(): Promise<string[]> {
    const { runArgs } = await this.getDefaultVolumeInfo();
    return runArgs;
  }

  async pull() {
    if (!this.image) {
      throw new Error(`Cannot pull '${this.name}', no image configured.`);
    }
    await dockerPull({ image: this.image });
  }

  async getBaseRunArgs(): Promise<string[]> {
    if (!this.#baseRunArgs) {
      const envArgs = parseEnv(this.#svcDef.environment);
      const ulArgs = parseULimits(this.#svcDef.ulimits);
      const netArgs = await this.getDefaultNetworkArgs();

      this.#baseRunArgs = ['--rm', ...envArgs, ...netArgs, ...ulArgs];
    }
    return this.#baseRunArgs;
  }

  async assembleRunArgs(
    containerName?: string = this.defaultContainerName,
    aliases?: string[] = [this.name],
    additionalArgs?: string[],
  ): Promise<string[]> {
    const additional = additionalArgs || [
      ...(await this.getDefaultPortArgs()),
      ...(await this.getDefaultVolumeArgs()),
    ];
    return [
      ...(await this.getBaseRunArgs()),
      ...(containerName ? ['--name', containerName] : []),
      ...aliases.flatMap((a) => (a ? ['--network-alias', a] : [])),
      ...additional,
    ];
  }

  async getRunArgs(
    avoidConflicts?: boolean = false,
    mapLocalPorts?: boolean = true,
  ): Promise<string[]> {
    const { name: cName, aliases, suffix } = await this.getNames(
      avoidConflicts,
    );
    const { runArgs: pArgs } = await this.getPorts(
      avoidConflicts,
      mapLocalPorts,
    );
    const { runArgs: vArgs } = await parseVolumes(this.#svcDef.volumes, suffix);
    return this.assembleRunArgs(cName, aliases, [...pArgs, ...vArgs]);
  }

  async up({
    healthCheck,
    avoidConflicts = false,
    mapVolumes = true,
    mapPorts = true,
    cmd = this.cmd,
    tracker = defaultTracker,
  }: UpOptions = {}): Promise<UpResult> {
    const { image } = this;
    if (!image) {
      throw new Error(
        `Cannot bring up service '${this.name}', no image defined.`,
      );
    }
    if (this.#tracker.containers.size) {
      buildLog(
        `Warning: up called on service '${this.name}' with already running container`,
      );
    }
    const { name: containerName, aliases, suffix } = await this.getNames(
      avoidConflicts,
    );
    const { runArgs: pArgs, ports } = await this.getPorts(
      avoidConflicts,
      mapPorts,
    );
    const { runArgs: vArgs, volumes } = mapVolumes
      ? await parseVolumes(this.#svcDef.volumes, suffix)
      : { runArgs: [], volumes: [] };

    let container = await dockerContainerFind(containerName, { all: true });
    if (container && !(await container.isRunning())) {
      await container.start();
    }
    if (!container) {
      await this.pull();
      await dockerComposeCreateNetworks(
        await this.getDefaultNetworks(),
        this.#dockerCompose,
        this.#tracker,
      );
      await dockerComposeCreateVolumes(
        volumes,
        this.#dockerCompose,
        this.#tracker,
      );
      const runArgs = await this.assembleRunArgs(containerName, aliases, [
        ...pArgs,
        ...vArgs,
      ]);
      container = await dockerContainerRunDaemon({
        image,
        runArgs,
        cmd,
      });
    } else {
      buildLog(`Reusing existing container for '${this.name}' service.`);
    }
    // This service tracks the things it created
    this.#tracker.containers.set(containerName, container);
    // The passed tracker needs to track this service
    tracker.services.set(this.name, this);

    const idAlias = container.id.slice(0, 12);
    aliases.push(idAlias);
    const urls = this.constructor.getUrls(ports, idAlias);

    const info: UpResult = {
      service: this,
      container,
      containerName,
      aliases,
      ports,
      volumes,
      urls,
    };
    await healthCheck?.(info);
    return info;
  }

  async down({
    includeDefaults = false,
    includeVolumes = false,
    includeNetworks = false,
  }: {
    includeDefaults?: boolean,
    includeVolumes?: boolean,
    includeNetworks?: boolean,
  } = {}) {
    buildLog(`Bringing down <${this.name}> service...`);
    await dockerComposeTeardown({
      tracker: this.#tracker,
      includeVolumes,
      includeNetworks,
    });
    if (includeDefaults) {
      const container = await dockerContainerFind(this.defaultContainerName);
      if (container) {
        await container.teardown(true);
      }
    }
  }

  static async parse(
    name: string,
    force?: boolean = true,
    dockerCompose?: ?(DockerCompose | string),
  ): Promise<?DockerComposeService> {
    const svcDef = await getServiceDef(name, force, dockerCompose);
    return svcDef ? new this(name, svcDef, dockerCompose) : null;
  }

  static getUrls(ports: PortMap[], alias: string): UrlMap[] {
    return ports.map(({ local, docker }) => ({
      local: local ? `http://localhost:${local}` : null,
      docker: docker ? `http://${alias}:${docker}` : null,
    }));
  }
}

export async function dockerComposeGetAllServices(
  dockerCompose?: ?(string | DockerCompose),
): Promise<MapObj<string, DockerComposeService>> {
  const { services } = await dockerComposeResolve(dockerCompose);
  return mapValuesAsync(services, (s, name) =>
    DockerComposeService.parse(name),
  );
}

export async function dockerComposeTeardown({
  includeDefaults = false,
  includeVolumes = false,
  includeNetworks = false,
  dockerCompose,
  tracker = defaultTracker,
}: {
  includeDefaults?: boolean,
  includeVolumes?: boolean,
  includeNetworks?: boolean,
  dockerCompose?: ?(string | DockerCompose),
  tracker?: DockerComposeResourceTracker,
} = {}): Promise<void> {
  if (!tracker.cleaning) {
    // eslint-disable-next-line no-param-reassign
    tracker.cleaning = (async () => {
      if (tracker.services.size) {
        buildLog('Bringing down started docker services...');
        const promises = Promise.all(
          Array.from(tracker.services.values()).map(async (s) =>
            s.down({ includeVolumes, includeNetworks }),
          ),
        );
        tracker.services.clear();
        await promises;
      }
      if (includeDefaults) {
        const { services } = await dockerComposeResolve(dockerCompose);
        const svcNames = keys(services);
        if (svcNames.length) {
          buildLog('Bringing down default docker services...');
          await Promise.all(
            svcNames.map(async (s) =>
              (await DockerComposeService.parse(s))?.down({
                includeDefaults,
                includeVolumes,
                includeNetworks,
              }),
            ),
          );
        }
      }

      if (tracker.containers.size) {
        buildLog('Stopping created docker containers...');
        const promises = Promise.all(
          Array.from(tracker.containers.values()).map(async (c) =>
            c.teardown(true),
          ),
        );
        tracker.containers.clear();
        await promises;
      }

      if (includeVolumes) {
        if (tracker.volumes.size) {
          buildLog('Removing created docker volumes...');
          const promises = Promise.all(
            Array.from(tracker.volumes.values()).map(async (v) => v.rm()),
          );
          tracker.volumes.clear();
          await promises;
        }
        if (includeDefaults) {
          buildLog('Removing default docker volumes...');
          const { volumes } = await dockerComposeResolve(dockerCompose);
          await Promise.all(
            entries(volumes).map(async ([key, val]) => {
              const name = val?.name || prefixName(key);
              await dockerVolumeRm(name, true);
            }),
          );
        }
      }

      if (includeNetworks) {
        if (tracker.networks.size) {
          buildLog('Removing created docker networks...');
          const promises = Promise.all(
            Array.from(tracker.networks.values()).map(async (n) => n.rm()),
          );
          tracker.networks.clear();
          await promises;
        }
        if (includeDefaults) {
          buildLog('Removing default docker networks...');
          const { networks } = await dockerComposeResolve(dockerCompose);
          await Promise.all(
            entries(networks).map(async ([key, val]) => {
              const name = val?.name || prefixName(key);
              try {
                await dockerNetworkDelete(name);
              } catch (err) {
                buildLog(`Error deleting network '${name}': ${err.message}`);
              }
            }),
          );
        }
      }
      // eslint-disable-next-line no-param-reassign
      tracker.cleaning = null;
    })();
  }
  return tracker.cleaning;
}

export type DockerContainerInfo = {|
  ...UpResult,
  id: string,
  image: string,
  name?: ?string,

  // for convenience, the first port mapping info
  port?: ?number,
  dockerPort?: ?number,
  url?: ?string,
  dockerUrl?: ?string,
|};

export async function dockerComposeRunService(
  key: string,
  upOptions?: UpOptions = {},
  dockerCompose?: ?(string | DockerCompose),
): Promise<DockerContainerInfo> {
  const service: ?DockerComposeService = await DockerComposeService.parse(
    key,
    false,
    dockerCompose,
  );
  if (!service) {
    throw new Error(`Failed to find service '${key}'`);
  }
  buildLog(`Starting <${service.name}> service...`);
  const upResult: UpResult = await service.up(upOptions);
  const {
    container,
    urls,
    urls: [{ local: url, docker: dockerUrl }],
    ports: [{ local: port, docker: dockerPort }],
  } = upResult;
  const { id, name, image } = container;
  urls.forEach(
    ({ local }) =>
      local && buildLog(`<${service.name}> accessible at ${local}`),
  );
  return {
    ...upResult,
    id,
    image,
    name,
    port,
    dockerPort,
    url,
    dockerUrl,
  };
}
