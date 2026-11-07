import bytes from 'bytes';
import fs from 'fs-extra';
import isReachable from 'is-reachable';
import os from 'os';
import path from 'path';

import { spawn, SpawnOptions } from './cp.js';
import {
  dockerContainerKill,
  dockerContainerRunDaemon,
} from './docker.container.js';
import { parseDockerDate } from './docker.date.js';
import { dockerNetworkConnect } from './docker.network.js';
import { cmdExists, isArm, isMac } from './env.js';
import { downloadFile } from './fetch.js';
import { mountDmg, unmountDmg } from './macos.js';
import { getCfg, getPkgName, getPkgScope } from './pkg.js';
import { buildLog, errorMessage } from './run.js';
import { getMainBranch, getVersion } from './version.js';

export interface DockerConfig {
  name?: string;
  registry?: string;
  repository?: string;
}

export function getDockerConfig(): DockerConfig {
  return getCfg().docker || {};
}

export async function dockerBuild(
  tags: string[] = ['latest'],
  buildArgs: string[] = [],
  target: string | null = null,
  extraArgs: null | string[] = [],
  repo: string = getDockerRepo(),
  dockerFile = './Dockerfile',
  workDir = '.',
): Promise<string> {
  const args = [
    'build',
    ...['-f', path.resolve(dockerFile)],
    ...(target ? ['--target', target] : []),
    ...tags.reduce<string[]>((ar, t) => [...ar, '-t', `${repo}:${t}`], []),
    ...buildArgs.reduce<string[]>((ar, a) => [...ar, '--build-arg', a], []),
    ...(extraArgs || []),
    path.resolve(workDir),
  ];

  return (await spawn('docker', args, { stdio: 'inherit' })).output;
}

export async function dockerTag(
  imageId: string,
  tags: string[] = ['latest'],
  repo: string = getDockerRepo(),
): Promise<void> {
  await Promise.all(
    tags.map(async (t) => {
      await spawn('docker', ['tag', imageId, `${repo}:${t}`]);
      buildLog(`Tagged image ${imageId} as ${repo}:${t}`);
    }),
  );
}

/**
 * Apply the standard convention for tagging the docker image for the project,
 * based on the semver git tag (or branch) being built.
 * For releases (a semver tag), applies `latest`, `M`, `M.m`, `M.m.p`
 * For pre-releases (e.g. tag `v1.2.3-rc.1`), applies `1.2.3-rc.1` and `latest-rc`
 * For untagged builds of the main branch, applies `latest-main`
 * For all other builds, no tag is applied
 * @param {string} imageId id of the docker image to which to apply the tags
 * @param {string} repo optional override of the docker repo url to use (derived from package.json by default)
 */
export async function dockerTagVersion(
  imageId: string,
  repo: string = getDockerRepo(),
) {
  const { branch, isRelease, major, minor, npm, patch, prerelease } =
    await getVersion();
  // determine what tags to apply
  if (isRelease) {
    await dockerTag(
      imageId,
      prerelease
        ? [npm, `latest-${prerelease.split('.')[0]}`]
        : ['latest', major, `${major}.${minor}`, `${major}.${minor}.${patch}`],
      repo,
    );
  } else if (branch === getMainBranch()) {
    await dockerTag(imageId, [`latest-${branch}`], repo);
  }
}

export interface DockerImage {
  created: Date;
  digest: string;
  id: string;
  repository: string;
  size: number;
  tag: string;
}

export type DockerImageFilter = (i: DockerImage) => boolean;

// One line of `docker images --format '{{json .}}'` output
interface DockerImageJson {
  CreatedAt: string;
  Digest: string;
  ID?: string;
  Repository: string;
  Size: string;
  Tag: string;
}

export async function dockerImages(
  repo: null | string = getDockerRepo(),
  filter: null | DockerImageFilter = null,
): Promise<DockerImage[]> {
  return (
    await spawn(
      'docker',
      ['images', '--format', `{{json .}}`, ...(repo ? [repo] : [])],
      { captureOutput: true },
    )
  ).output
    .split('\n')
    .filter((line) => !!line.trim())
    .map((l) => {
      const {
        CreatedAt,
        Digest: digest,
        ID: id,
        Repository: repository,
        Size,
        Tag: tag,
      } = JSON.parse(l.trim()) as DockerImageJson;
      return {
        created: parseDockerDate(CreatedAt),
        digest,
        id,
        repository,
        size: bytes.parse(Size) || 0,
        tag,
      };
    })
    .filter((m): m is DockerImage => m.id != null)
    .filter((m) => (typeof filter === 'function' ? filter(m) : true));
}

export async function getDockerId(
  tag = 'latest',
  repo: null | string = null,
): Promise<string> {
  return (await dockerImages(repo, (m) => m.tag === tag)).map((m) => m.id)[0];
}

export async function getUntaggedDockerIds(
  repo?: string,
  filter: null | DockerImageFilter = null,
): Promise<string[]> {
  return (
    await dockerImages(
      repo,
      (m) =>
        m.tag === '<none>' && (typeof filter === 'function' ? filter(m) : true),
    )
  ).map((m) => m.id);
}

export async function getDockerTags(
  id?: null | string,
  repo?: null | string,
  fullName = false,
  filter: null | DockerImageFilter = null,
): Promise<string[]> {
  return (
    await dockerImages(
      repo,
      (m) =>
        (!id || m.id === id) &&
        (typeof filter === 'function' ? filter(m) : true),
    )
  ).map((m) => (fullName ? `${m.repository}:${m.tag}` : m.tag));
}

export async function getDockerDigest(
  imageId: string,
  repo?: string,
): Promise<string> {
  return (await dockerImages(repo, (m) => m.id === imageId)).map(
    (m) => m.digest,
  )[0];
}

interface DockerLoginOptions {
  password?: string;
  registry?: string;
  user?: string;
}

export async function dockerLogin({
  password = process.env.DOCKER_PASSWORD,
  registry = process.env.DOCKER_REGISTRY,
  user = process.env.DOCKER_USER,
}: DockerLoginOptions = {}): Promise<void> {
  const reg = registry || getDockerConfig().registry;
  await spawn(
    'docker',
    ['login', '-u', user || '', '-p', password || '', ...(reg ? [reg] : [])],
    { stdio: 'inherit' },
  );
}

export async function dockerPush(
  tags: string[] = ['latest'],
  repo: string = getDockerRepo(),
) {
  // do this sequentially, so you don't push the same image simultaneously
  await tags.reduce(async (prev, tag) => {
    await prev;
    await spawn('docker', ['push', `${repo}:${tag}`], { stdio: 'inherit' });
  }, Promise.resolve());
}

export interface DockerPullOptions {
  image: string;
  offline?: boolean;
  testUrl?: string | null;
}

export async function dockerPull({
  image,
  offline = process.argv.includes('--offline'),
  testUrl,
}: DockerPullOptions) {
  if (offline || !(await isReachable(testUrl || 'https://hub.docker.com'))) {
    if (!offline) {
      throw new Error('Offline, cannot docker pull');
    }
    buildLog('It looks like you are offline, skipping docker pull');
  } else {
    // throws on failure
    await spawn('docker', ['pull', image], { stdio: 'inherit' });
  }
}

export async function dockerRmi(
  images: string[] = [],
  ignoreErrors = true,
): Promise<void> {
  // must do these sequentially, or they will interfere with each other
  await images.reduce(async (prev, image) => {
    await prev;
    await spawn('docker', ['rmi', image], { stdio: 'inherit' }).catch(
      (err: unknown) => {
        if (ignoreErrors) {
          buildLog(
            `Warning (ignored Error): Failed to rm image(s): ${errorMessage(
              err,
            )}`,
          );
        } else {
          throw err;
        }
      },
    );
  }, Promise.resolve());
}

export function getDockerRepo(): string {
  const { name: dkrName, registry, repository: dkrRepo } = getDockerConfig();
  const repository = dkrRepo || getPkgScope();
  const name = dkrName || getPkgName(false);
  if (!repository || !name) {
    throw new Error(
      'Docker configuration is missing or incomplete in package.json',
    );
  }
  return `${registry ? `${registry}/` : ''}${repository}/${name}`;
}

export interface PullAndRunContainerOptions extends DockerPullOptions {
  alias?: string | null;
  cmd?: string[];
  network?: string | null;
  runArgs?: string[];
}

export async function dockerPullAndRunContainer(
  options: PullAndRunContainerOptions,
): Promise<string> {
  const {
    alias,
    cmd = [],
    image,
    network,
    offline = process.argv.includes('--offline'),
    runArgs = [],
    testUrl,
  } = options;

  try {
    await dockerPull({ image, offline, testUrl });
  } catch (err) {
    if (err instanceof Error) {
      buildLog(
        `docker pull failed (${err.message}), attempting to continue...`,
      );
    }
  }
  const { id } = await dockerContainerRunDaemon({ cmd, image, runArgs });
  if (network) {
    await dockerNetworkConnect(network, id, alias);
  }
  return id;
}

export interface CopyFilePathConfig {
  from: string;
  to: string;
}

export interface CopyFilesFromDockerImageConfig {
  filePaths: CopyFilePathConfig[];
  ignoreErrors?: boolean;
  imageId: string;
}

export async function copyFilesFromDockerImage({
  filePaths,
  ignoreErrors,
  imageId,
}: CopyFilesFromDockerImageConfig): Promise<void> {
  const container = await dockerContainerRunDaemon({
    cmd: ['read', '-p', 'pause'],
    image: imageId,
    runArgs: ['-it', '--rm', '--entrypoint=/bin/bash'],
  });

  buildLog(`Copying Files from Docker Image - imageId (${imageId})`);

  const spawnOptions: SpawnOptions = {
    captureOutput: false,
    pipeOutput: true,
    stdio: 'inherit',
  };
  const copyErrors = [];

  try {
    // must be awaited: with forEach the copies were never waited on, so the
    // container was killed mid-copy and copyErrors was always empty below
    await Promise.all(
      filePaths.map(async (fp) => {
        // Try to copy from the Debug Folder
        try {
          await spawn(
            'docker',
            ['cp', `${container.id}:${fp.from}`, fp.to],
            spawnOptions,
          );
          buildLog(`Copied ${fp.from} => ${fp.to}`);
        } catch (error) {
          copyErrors.push(error);
          buildLog(`Error copying file ${fp.from}`);
        }
      }),
    );
  } finally {
    try {
      await dockerContainerKill(container.id);
    } catch (error) {
      copyErrors.push(error);
    }
  }

  if (copyErrors.length > 0 && ignoreErrors !== true) {
    throw new Error('Some files failed to copy');
  }
}

export type DockerStatus = 'running' | 'stopped' | 'unresponsive';

// `docker info` writes one of these when the CLI cannot reach a daemon that is
// not started. The text differs between platforms and Docker versions. For
// example, Docker 29 on macOS reports "failed to connect to the docker API".
// Match only connection diagnostics here. A plugin warning can contain a
// generic filesystem error, and such a warning must not hide a healthy daemon.
const dockerStoppedMarkers = [
  'cannot connect to the docker daemon',
  'is the docker daemon running',
  'failed to connect to the docker api',
  'check if the path is correct and if the daemon is running',
  'error during connect',
];

// The daemon answered, but with an error. Older Docker versions exit 0 and
// print the error, so the output must be checked before the exit code.
const dockerUnresponsiveMarkers = [
  'bad response from docker engine',
  'error response from daemon',
  'error reading remote info',
  'errors pretty printing info',
];

/**
 * Classify the result of `docker info`.
 *
 * Docker can be running but unresponsive. In that case the daemon returns an
 * error, for example "Bad response from Docker engine". A daemon that is not
 * started reports that it cannot connect instead. A build must not try to
 * start an unresponsive daemon, because the start command has no effect.
 */
export const classifyDockerInfo = (
  exitCode: number,
  output: string,
): DockerStatus => {
  const lower = output.toLowerCase();
  if (dockerStoppedMarkers.some((marker) => lower.includes(marker))) {
    return 'stopped';
  }
  if (dockerUnresponsiveMarkers.some((marker) => lower.includes(marker))) {
    return 'unresponsive';
  }
  return exitCode === 0 ? 'running' : 'unresponsive';
};

export interface DockerInfo {
  output: string;
  status: DockerStatus;
}

export const getDockerInfo = async (): Promise<DockerInfo> => {
  try {
    const { code, output } = await spawn('docker', ['info'], {
      captureOutput: true,
      rejectOnErrorCode: false,
    });
    return { output, status: classifyDockerInfo(code, output) };
  } catch (err) {
    // The docker binary is missing or could not start.
    return { output: errorMessage(err), status: 'stopped' };
  }
};

export const getDockerStatus = async () => (await getDockerInfo()).status;

export const dockerIsRunning = async () =>
  (await getDockerStatus()) === 'running';

// Pick the most useful line from `docker info` for the error message.
const dockerErrorDetail = (output: string): string | undefined =>
  output
    .split('\n')
    .map((line) => line.trim())
    .find((line) => /^(error|failed|permission denied)/i.test(line));

export const throwIfDockerUnresponsive = ({ output, status }: DockerInfo) => {
  if (status !== 'unresponsive') {
    return;
  }
  const detail = dockerErrorDetail(output);
  throw new Error(
    `Docker is running but unresponsive${
      detail ? ` (${detail})` : ''
    }. Restart Docker and try again.`,
  );
};

/**
 * Wait until `docker info` succeeds. This runs after the Docker app is started,
 * so it tolerates transient daemon errors until the timeout.
 */
export const waitForDockerToStart = async (
  timeoutSeconds = 600,
  name = 'Docker',
) => {
  let attempts = 0;
  for (;;) {
    const status = await getDockerStatus();
    if (status === 'running') {
      if (attempts >= 5) {
        process.stdout.write('\n');
      }
      return;
    }
    attempts += 1;
    if (attempts % 5 === 0) {
      process.stdout.write('.');
    }
    if (attempts > timeoutSeconds) {
      throw new Error(`Timeout starting ${name} (last status: ${status})`);
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
  }
};

export const ensureDockerRunning = async (timeoutSeconds = 600) => {
  const info = await getDockerInfo();
  if (info.status === 'running') {
    return;
  }
  throwIfDockerUnresponsive(info);
  if (!isMac()) {
    throw new Error('Docker is not running, please start it manually');
  }
  buildLog('docker is not running, starting it...');
  await spawn('open', ['-a', '/Applications/Docker.app']);
  await waitForDockerToStart(timeoutSeconds);
};

export const ensureDockerInstalled = async () => {
  if (!(await cmdExists('docker'))) {
    if (isMac()) {
      const dockerUrl = `https://desktop.docker.com/mac/main/${
        isArm() ? 'arm64' : 'amd64'
      }/Docker.dmg`;
      const dockerDmg = path.join(os.tmpdir(), 'Docker.dmg');
      buildLog(
        `docker not found, downloading (${isArm() ? 'arm' : 'intel'})...`,
      );
      await downloadFile(dockerUrl, dockerDmg);

      const dockerVolume = path.join(os.tmpdir(), 'Docker.volume');
      const dockerApp = path.join(dockerVolume, 'Docker.app');
      try {
        buildLog('Mounting Docker.dmg...');
        await mountDmg(dockerDmg, dockerVolume);

        const dockerAppInstalled = path.resolve('/Applications', 'Docker.app');
        buildLog('Copying to applications...');
        await fs.copy(dockerApp, dockerAppInstalled);
      } catch (err) {
        buildLog(
          'Failed to install docker automatically. Get it at https://docs.docker.com/get-docker/ and install manually.',
        );
        throw err;
      } finally {
        buildLog('Unmounting Docker.dmg...');
        await unmountDmg(dockerVolume);
        await fs.remove(dockerDmg);
      }
      buildLog('Docker installed!');
    } else {
      throw new Error(
        'docker is not installed. Get it at https://docs.docker.com/get-docker/',
      );
    }
  }
};

export const ensureDockerForMacConfigured = async (
  desiredConfig?: null | Record<string, unknown>,
) => {
  if (isMac()) {
    if (!desiredConfig) {
      buildLog('Skipping docker configuration due to empty config value');
      return;
    }
    const configPath = path.join(
      os.homedir(),
      '/Library/Group Containers/group.com.docker/settings.json',
    );
    await fs.ensureDir(path.dirname(configPath));
    if (!(await fs.pathExists(configPath))) {
      // Must run Docker at least once to create the config file
      await ensureDockerRunning();
    }
    if (!(await fs.pathExists(configPath))) {
      throw new Error('Failed to locate the Docker config file');
    }
    const existingConfig = (await fs.readJson(configPath)) as Record<
      string,
      unknown
    >;
    if (
      !Object.entries(desiredConfig).every(
        ([key, value]) => existingConfig[key] === value,
      )
    ) {
      buildLog('Adjusting Docker config...');
      await fs.writeJson(
        configPath,
        {
          ...existingConfig,
          ...desiredConfig,
        },
        { spaces: 2 },
      );

      if (await dockerIsRunning()) {
        // Restart the Docker app
        buildLog('Killing Docker...');
        await spawn('osascript', ['-e', `quit app "Docker"`]);
        await ensureDockerRunning();
      }
    }
  }
};
