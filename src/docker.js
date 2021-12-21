// @flow
import path from 'path';
import bytes from 'bytes';
import isReachable from 'is-reachable';
import moment from 'moment';
import { buildLog } from './run';
import { getCfg, getPkgName, getPkgScope } from './pkg';
import { spawn } from './cp';
import { getVersion, getDevBranch } from './version';
import {
  dockerContainerRunDaemon,
  dockerContainerKill,
} from './docker.container';
import { dockerNetworkConnect } from './docker.network';

export type DockerConfig = {
  registry?: string,
  repository?: string,
  name?: string,
};

export function getDockerConfig(): DockerConfig {
  return getCfg().docker || {};
}

export const parseDockerDate = (date: string): Date =>
  moment(date, 'YYYY-MM-DD HH:mm:ss ZZ').toDate();

export async function dockerBuild(
  tags: string[] = ['latest'],
  buildArgs: string[] = [],
  target: ?string = null,
  extraArgs?: ?(string[]) = [],
  repo: string = getDockerRepo(),
  dockerFile: string = './Dockerfile',
  workDir: string = '.',
): Promise<string> {
  const args = [
    'build',
    ...['-f', path.resolve(dockerFile)],
    ...(target ? ['--target', target] : []),
    ...tags.reduce((ar, t) => [...ar, '-t', `${repo}:${t}`], []),
    ...buildArgs.reduce((ar, a) => [...ar, '--build-arg', a], []),
    ...(extraArgs || []),
    path.resolve(workDir),
  ];

  return spawn('docker', args, { stdio: 'inherit' });
}

export async function dockerTag(
  imageId: string,
  tags: string[] = ['latest'],
  repo?: string = getDockerRepo(),
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
 * based on the source control branch being built.
 * For releases, applies `latest`, `M.m.p`, `M.m`, `M`
 * For release candidates, applies `latest-rc`
 * For feature branches, applies `latest-feature`
 * For development branch, applies `latest-dev`
 * All other branches, no tag is applies
 * @param {string} imageId id of the docker image to which to apply the tags
 * @param {string} repo optional override of the docker repo url to use (derived from package.json by default)
 */
export async function dockerTagVersion(
  imageId: string,
  repo?: string = getDockerRepo(),
) {
  const { isRelease, major, minor, patch, branch } = await getVersion();
  // determine what tags to apply
  if (isRelease) {
    await dockerTag(
      imageId,
      ['latest', `${major}`, `${major}.${minor}`, `${major}.${minor}.${patch}`],
      repo,
    );
  } else if (branch === (await getDevBranch())) {
    await dockerTag(imageId, ['latest-dev'], repo);
  } else if (branch.match(/^(release|patch)-/)) {
    await dockerTag(imageId, ['latest-rc'], repo);
  } else if (branch.match(/^feature-/)) {
    await dockerTag(imageId, ['latest-feature'], repo);
  }
}

export type DockerImage = {
  repository: string,
  tag: string,
  id: string,
  digest: string,
  created: Date,
  size: number,
};

export type DockerImageFilter = (i: DockerImage) => boolean;

export async function dockerImages(
  repo?: ?string = getDockerRepo(),
  filter?: ?DockerImageFilter = null,
): Promise<DockerImage[]> {
  return (
    await spawn(
      'docker',
      ['images', '--format', `{{json .}}`, ...(repo ? [repo] : [])],
      { captureOutput: true },
    )
  )
    .split('\n')
    .filter((line) => !!line.trim())
    .map((l) => {
      const {
        Repository: repository,
        Tag: tag,
        ID: id,
        Digest: digest,
        CreatedAt,
        Size,
      } = JSON.parse(l.trim());
      return {
        repository,
        tag,
        id,
        digest,
        created: parseDockerDate(CreatedAt),
        size: bytes.parse(Size),
      };
    })
    .filter(
      (m) =>
        (m && m.id) != null &&
        (typeof filter === 'function' ? filter(m) : true),
    );
}

export async function getDockerId(
  tag: string = 'latest',
  repo?: ?string,
): Promise<string> {
  return (await dockerImages(repo, (m) => m.tag === tag)).map((m) => m.id)[0];
}

export async function getUntaggedDockerIds(
  repo?: ?string,
  filter?: ?DockerImageFilter = null,
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
  id?: ?string,
  repo?: ?string,
  fullName: boolean = false,
  filter?: ?DockerImageFilter = null,
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

export async function dockerLogin(
  user: string,
  password: string,
  registry: string,
): Promise<void> {
  const reg = registry || getDockerConfig().registry;
  await spawn(
    'docker',
    [
      'login',
      '-u',
      user || process.env.ARTIFACTORY_USER || '',
      '-p',
      password || process.env.ARTIFACTORY_PASSWORD || '',
      ...(reg ? [reg] : []),
    ],
    { stdio: 'inherit' },
  );
}

export async function dockerPush(
  tags?: string[] = ['latest'],
  repo?: string = getDockerRepo(),
) {
  // do this sequentially, so you don't push the same image simultaneously
  await tags.reduce(async (prev, tag) => {
    await prev;
    await spawn('docker', ['push', `${repo}:${tag}`], { stdio: 'inherit' });
  }, Promise.resolve());
}

export type DockerPullOptions = {
  image: string,
  offline?: boolean,
  testUrl?: ?string,
};

export async function dockerPull({
  image,
  offline = process.argv.includes('--offline'),
  testUrl,
}: DockerPullOptions) {
  if (offline || !(await isReachable(testUrl || 'https://hub.docker.com'))) {
    if (offline === false) {
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
  ignoreErrors: boolean = true,
): Promise<void> {
  // must do these sequentially, or they will interfere with each other
  await images.reduce(async (prev, image) => {
    await prev;
    await spawn('docker', ['rmi', image], { stdio: 'inherit' }).catch((err) => {
      if (ignoreErrors) {
        buildLog(
          `Warning (ignored Error): Failed to rm image(s): ${err.message}`,
        );
      } else {
        throw err;
      }
    });
  }, Promise.resolve());
}

export function getDockerRepo(): string {
  const { registry, repository: dkrRepo, name: dkrName } = getDockerConfig();
  const repository = dkrRepo || getPkgScope();
  const name = dkrName || getPkgName(false);
  if (!repository || !name) {
    throw new Error(
      'Docker configuration is missing or incomplete in package.json',
    );
  }
  return `${registry ? `${registry}/` : ''}${repository}/${name}`;
}

export type PullAndRunContainerOptions = {
  ...DockerPullOptions,
  runArgs?: string[],
  cmd?: string[],
  network?: ?string,
  alias?: ?string,
};

export async function dockerPullAndRunContainer(
  image: string,
  options: PullAndRunContainerOptions = {},
): Promise<string> {
  const {
    runArgs = [],
    cmd = [],
    network,
    alias,
    offline = process.argv.includes('--offline'),
    testUrl,
  } = options;

  try {
    await dockerPull({ image, offline, testUrl });
  } catch (err) {
    buildLog(`docker pull failed (${err.message}), attempting to continue...`);
  }
  const { id } = await dockerContainerRunDaemon({ image, runArgs, cmd });
  if (network) {
    await dockerNetworkConnect(network, id, alias);
  }
  return id;
}

export type CopyFilePathConfig = {
  from: string,
  to: string,
};

export type CopyFilesFromDockerImageConfig = {
  imageId: string,
  filePaths: CopyFilePathConfig[],
  ignoreErrors?: ?boolean,
};

export async function copyFilesFromDockerImage({
  imageId,
  filePaths,
  ignoreErrors,
}: CopyFilesFromDockerImageConfig): Promise<any> {
  const container = await dockerContainerRunDaemon({
    image: imageId,
    runArgs: ['-it', '--rm', '--entrypoint=/bin/bash'],
    cmd: ['read', '-p', 'pause'],
  });

  buildLog(`Copying Files from Docker Image - imageId (${imageId})`);

  const spawnOptions = {
    stdio: 'inherit',
    pipeOutput: true,
    captureOutput: false,
  };
  const copyErrors = [];

  try {
    filePaths.forEach(async (fp) => {
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
    });
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
