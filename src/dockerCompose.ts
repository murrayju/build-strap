import fs from 'fs-extra';
import getPort from 'get-port';
import yaml from 'js-yaml';
import path from 'path';

import {
  DockerContainer,
  dockerContainerFind,
  dockerContainerRunDaemon,
} from './docker.container.js';
import { dockerPull } from './docker.js';
import {
  DockerNetwork,
  dockerNetworkCreate,
  DockerNetworkCreateOptions,
  dockerNetworkDelete,
} from './docker.network.js';
import {
  DockerVolume,
  dockerVolumeCreate,
  DockerVolumeCreateOptions,
  dockerVolumeRm,
} from './docker.volume.js';
import { mapValuesAsync } from './maps.js';
import { buildLog } from './run.js';

export type DockerComposeResourceTracker = {
  cleaning: null | Promise<void>;
  containers: Map<string, DockerContainer>;
  networks: Map<string, DockerNetwork>;
  services: Map<string, DockerComposeService>;
  volumes: Map<string, DockerVolume>;
};

export const dockerComposeCreateResourceTracker =
  (): DockerComposeResourceTracker => ({
    cleaning: null,
    containers: new Map(),
    networks: new Map(),
    services: new Map(),
    volumes: new Map(),
  });

const defaultTracker = dockerComposeCreateResourceTracker();

type DockerComposeEnvDef = string[] | Record<string, string>;

type DockerComposeULimitDef = number | { hard: number; soft: number };

type DockerComposeULimitsDef = Record<string, DockerComposeULimitDef>;

interface DockerComposeServiceDef {
  command?: string[];
  container_name?: string;
  environment?: DockerComposeEnvDef;
  image?: string;
  links?: string[];
  networks?: string[];
  ports?: string[];
  ulimits?: DockerComposeULimitsDef;
  volumes?: string[];
}

interface DockerComposeVolumeDef extends DockerVolumeCreateOptions {
  name?: string;
}

interface DockerComposeNetworkDef extends DockerNetworkCreateOptions {
  name?: string;
}

interface DockerCompose {
  networks?: Record<string, DockerComposeNetworkDef>;
  services?: Record<string, DockerComposeServiceDef>;
  version: string;
  volumes?: Record<string, DockerComposeVolumeDef>;
}

/**
 * Parse a docker-compose.yml file into a pojo representation
 * @param {string} filePath Path to the docker-compose.yml file
 */
export const dockerComposeParse = async (
  filePath = './docker-compose.yml',
): Promise<DockerCompose> =>
  yaml.load(await fs.readFile(filePath, 'utf8')) as DockerCompose;

let dc: null | DockerCompose = null;

/**
 * Get the main docker-compose.yml from the root of the repo
 * @param {boolean} force Force reload from file
 */
export const dockerComposeGetMain = async (
  force = false,
): Promise<DockerCompose> => {
  if (force || !dc) {
    dc = await dockerComposeParse();
  }
  return dc;
};

// Function that handles passed dockerCompose as either a file path or `DockerCompose` object.
// If not passed, defaults to the main docker-compose.yml from the root of the repo
const dockerComposeResolve = async (
  dockerCompose?: null | string | DockerCompose,
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
  dockerCompose?: null | string | DockerCompose,
): Promise<null | DockerComposeServiceDef> =>
  (await dockerComposeResolve(dockerCompose, force)).services?.[name] || null;

interface PortMap {
  docker: number;
  local: null | number;
  localDefault: number;
}

interface UrlMap {
  docker: null | string;
  local: null | string;
}

interface ParsedPortInfo {
  ports: PortMap[];
  runArgs: string[];
}

const parsePorts = async (
  portsCfg: string[] = [],
  avoidConflicts = true,
  mapLocal = true,
  host = '0.0.0.0',
): Promise<ParsedPortInfo> => {
  const ports: PortMap[] = [];
  const runArgs = await portsCfg.reduce(async (args, portStr) => {
    const [lp, dp] = portStr.split(':');
    const localDefault = parseInt(lp, 10);
    const docker = parseInt(dp, 10);
    const local = mapLocal
      ? avoidConflicts
        ? await getPort({ host, port: localDefault })
        : localDefault
      : null;
    ports.push({ docker, local, localDefault });
    return local ? [...(await args), '-p', `${local}:${docker}`] : args;
  }, Promise.resolve([] as string[]));
  return { ports, runArgs };
};

const parseEnv = (env: DockerComposeEnvDef = []): string[] =>
  Array.isArray(env)
    ? env.flatMap((e) => ['-e', e])
    : Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);

const parseULimits = (ul: DockerComposeULimitsDef = {}): string[] =>
  Object.entries(ul).flatMap(([k, v]) => [
    '--ulimit',
    `${k}=${
      typeof v === 'number' ? v : `${v.soft}${v.hard ? `:${v.hard}` : ''}`
    }`,
  ]);

interface ParsedVolumeInfo {
  runArgs: string[];
  volumes: string[];
}

const parseVolumes = async (
  volCfg: string[] = [],
  nameSuffix = '',
  dockerCompose: null | string | DockerCompose = null,
): Promise<ParsedVolumeInfo> => {
  const { volumes: volMap } = await dockerComposeResolve(dockerCompose);
  const volumes = [] as string[];
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

interface ParsedNetworkInfo {
  networks: string[];
  runArgs: string[];
}

const parseNetworks = async (
  netCfg: string[] = [],
  dockerCompose: null | (string | DockerCompose) = null,
): Promise<ParsedNetworkInfo> => {
  const { networks: netMap } = await dockerComposeResolve(dockerCompose);
  const networks = netCfg.map((n) => netMap?.[n].name || prefixName(n));
  return {
    networks,
    runArgs: networks.flatMap((n) => ['--network', n]),
  };
};

export const dockerComposeCreateNetworks = async (
  names?: null | string[],
  dockerCompose?: null | (string | DockerCompose),
  tracker: DockerComposeResourceTracker = defaultTracker,
) => {
  const { networks = {} } = await dockerComposeResolve(dockerCompose);
  await Promise.all(
    Object.entries(networks).map(async ([key, val]) => {
      const name = val?.name || prefixName(key);
      if (names?.includes(name)) {
        const network = await dockerNetworkCreate(name, val);
        if (network) {
          tracker.networks.set(name, network);
        }
      }
    }),
  );
};

export const dockerComposeCreateVolumes = async (
  names?: string[],
  dockerCompose?: null | (string | DockerCompose),
  tracker: DockerComposeResourceTracker = defaultTracker,
) => {
  const { volumes = {} } = await dockerComposeResolve(dockerCompose);
  await Promise.all(
    Object.entries(volumes).map(async ([key, val]) => {
      const name = val?.name || prefixName(key);
      if (!names || names.includes(name)) {
        const volume = await dockerVolumeCreate(name, val);
        if (volume) {
          tracker.volumes.set(name, volume);
        }
      }
    }),
  );
};

type HealthCheckFn = (result: UpResult) => Promise<void>;

interface UpOptions {
  avoidConflicts?: boolean;
  cmd?: string[];
  healthCheck?: HealthCheckFn;
  mapPorts?: boolean;
  mapVolumes?: boolean;
  tracker?: DockerComposeResourceTracker;
}

interface ServiceNameInfo {
  aliases: string[];
  name: string;
  suffix: string;
}

interface UpResult {
  aliases: string[];
  container: DockerContainer;
  containerName: string;
  ports: PortMap[];
  service: DockerComposeService;
  urls: UrlMap[];
  volumes: string[];
}

export class DockerComposeService {
  #name: string;

  #svcDef: DockerComposeServiceDef;

  #dockerCompose: null | DockerCompose | string;

  #tracker: DockerComposeResourceTracker = dockerComposeCreateResourceTracker();

  // lazily computed
  #parsedPorts: null | ParsedPortInfo = null;

  #parsedNetworks: null | ParsedNetworkInfo = null;

  #parsedVolumes: null | ParsedVolumeInfo = null;

  #baseRunArgs: null | string[] = null;

  constructor(
    name: string,
    serviceDef: DockerComposeServiceDef,
    dockerCompose?: null | (DockerCompose | string),
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

  get image(): null | string {
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
  async getNames(avoidConflicts = false, max = 100): Promise<ServiceNameInfo> {
    /* eslint-disable no-await-in-loop */
    for (let i = 0; i < max; i += 1) {
      const suffix = i ? `-${i}` : '';
      const testName = `${this.defaultContainerName}${suffix}`;
      const container = await dockerContainerFind(testName, { all: true });
      if (!avoidConflicts || !container) {
        return {
          aliases: [`${this.name}${suffix}`],
          name: testName,
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
    avoidConflicts = false,
    mapLocal = true,
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
    return DockerComposeService.getUrls(
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
    containerName: string = this.defaultContainerName,
    aliases: string[] = [this.name],
    additionalArgs: null | string[] = null,
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
    avoidConflicts = false,
    mapLocalPorts = true,
  ): Promise<string[]> {
    const {
      aliases,
      name: cName,
      suffix,
    } = await this.getNames(avoidConflicts);
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
    const {
      aliases,
      name: containerName,
      suffix,
    } = await this.getNames(avoidConflicts);
    const { ports, runArgs: pArgs } = await this.getPorts(
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
        cmd,
        image,
        runArgs,
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
    const urls = DockerComposeService.getUrls(ports, idAlias);

    const info: UpResult = {
      aliases,
      container,
      containerName,
      ports,
      service: this,
      urls,
      volumes,
    };
    await healthCheck?.(info);
    return info;
  }

  async down({
    includeDefaults = false,
    includeNetworks = false,
    includeVolumes = false,
  }: {
    includeDefaults?: boolean;
    includeNetworks?: boolean;
    includeVolumes?: boolean;
  } = {}) {
    buildLog(`Bringing down <${this.name}> service...`);
    await dockerComposeTeardown({
      includeNetworks,
      includeVolumes,
      tracker: this.#tracker,
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
    force = true,
    dockerCompose: null | (DockerCompose | string) = null,
  ): Promise<null | DockerComposeService> {
    const svcDef = await getServiceDef(name, force, dockerCompose);
    return svcDef ? new this(name, svcDef, dockerCompose) : null;
  }

  static getUrls(ports: PortMap[], alias: string): UrlMap[] {
    return ports.map(({ docker, local }) => ({
      docker: docker ? `http://${alias}:${docker}` : null,
      local: local ? `http://localhost:${local}` : null,
    }));
  }
}

export async function dockerComposeGetAllServices(
  dockerCompose?: null | (string | DockerCompose),
): Promise<Record<string, null | DockerComposeService>> {
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
  dockerCompose?: null | (string | DockerCompose);
  includeDefaults?: boolean;
  includeNetworks?: boolean;
  includeVolumes?: boolean;
  tracker?: DockerComposeResourceTracker;
} = {}): Promise<void> {
  if (!tracker.cleaning) {
    // eslint-disable-next-line no-param-reassign
    tracker.cleaning = (async () => {
      if (tracker.services.size) {
        buildLog('Bringing down started docker services...');
        const promises = Promise.all(
          Array.from(tracker.services.values()).map(async (s) =>
            s.down({ includeNetworks, includeVolumes }),
          ),
        );
        tracker.services.clear();
        await promises;
      }
      if (includeDefaults) {
        const { services } = await dockerComposeResolve(dockerCompose);
        const svcNames = Object.keys(services ?? {});
        if (svcNames.length) {
          buildLog('Bringing down default docker services...');
          await Promise.all(
            svcNames.map(async (s) =>
              (
                await DockerComposeService.parse(s)
              )?.down({
                includeDefaults,
                includeNetworks,
                includeVolumes,
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
            Object.entries(volumes ?? {}).map(async ([key, val]) => {
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
            Object.entries(networks ?? {}).map(async ([key, val]) => {
              const name = val?.name || prefixName(key);
              try {
                await dockerNetworkDelete(name);
              } catch (err: any) {
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

export interface DockerContainerInfo extends UpResult {
  dockerPort?: null | number;
  dockerUrl?: null | string;
  id: string;

  image: string;
  name?: null | string;
  // for convenience, the first port mapping info
  port?: null | number;
  url?: null | string;
}

export async function dockerComposeRunService(
  key: string,
  upOptions: UpOptions = {},
  dockerCompose: null | string | DockerCompose = null,
): Promise<DockerContainerInfo> {
  const service: null | DockerComposeService = await DockerComposeService.parse(
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
    urls: [{ docker: dockerUrl, local: url }],
    ports: [{ docker: dockerPort, local: port }],
  } = upResult;
  const { id, image, name } = container;
  urls.forEach(
    ({ local }) =>
      local && buildLog(`<${service.name}> accessible at ${local}`),
  );
  return {
    ...upResult,
    dockerPort,
    dockerUrl,
    id,
    image,
    name,
    port,
    url,
  };
}
