// @flow
import path from 'path';
import bytes from 'bytes';
import isReachable from 'is-reachable';
import { buildLog } from './run';
import { getCfg, getPkgName, getPkgScope } from './pkg';
import { spawn } from './cp';
import { getVersion, getDevBranch } from './version';

export type DockerConfig = {
  registry?: string,
  repository?: string,
  name?: string,
};

export function getDockerConfig(): DockerConfig {
  return getCfg().docker || {};
}

export async function dockerBuild(
  tags: string[] = ['latest'],
  buildArgs: string[] = [],
  target: ?string = null,
  extraArgs?: ?(string[]) = [],
  repo: string = getDockerRepo(),
  dockerFile: string = './Dockerfile',
  workDir: string = '.',
) {
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

export async function dockerRun(
  runArgs: string[] = [],
  image: string,
  cmdArgs: string[],
  pipeOutput: boolean = true,
  captureOutput: boolean = false,
) {
  const args = ['run', ...runArgs, image, ...cmdArgs];

  return spawn('docker', args, { stdio: 'inherit' }, pipeOutput, captureOutput);
}

export async function dockerTag(
  imageId: string,
  tags: string[] = ['latest'],
  repo?: string = getDockerRepo(),
) {
  return Promise.all(
    tags.map(async t => {
      await spawn('docker', ['tag', imageId, `${repo}:${t}`]);
      buildLog(`Tagged image ${imageId} as ${repo}:${t}`);
    }),
  );
}

export async function dockerApplyStandardTags(
  imageId: string,
  repo?: string = getDockerRepo(),
) {
  const { major, minor, patch, branch, isRelease } = await getVersion();
  // determine what tags to apply
  if (isRelease) {
    await dockerTag(
      imageId,
      ['latest', major, `${major}.${minor}`, `${major}.${minor}.${patch}`],
      repo,
    );
  } else if (branch === getDevBranch()) {
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
  const s = '~|~'; // separator
  return (
    await spawn(
      'docker',
      [
        'images',
        '--format',
        `{{.Repository}}${s}{{.Tag}}${s}{{.ID}}${s}{{.Digest}}${s}{{.CreatedAt}}${s}{{.Size}}`,
        ...(repo ? [repo] : []),
      ],
      {},
      false,
      true,
    )
  )
    .split('\n')
    .map(l => {
      const [repository, tag, id, digest, createdStr, sizeStr] = l.split(s);
      return {
        repository,
        tag,
        id,
        digest,
        created: new Date(Date.parse(createdStr)),
        size: bytes.parse(sizeStr),
      };
    })
    .filter(
      m =>
        (m && m.id) != null &&
        (typeof filter === 'function' ? filter(m) : true),
    );
}

export async function getDockerId(tag: string = 'latest', repo?: ?string) {
  return (await dockerImages(repo, m => m.tag === tag)).map(m => m.id)[0];
}

export async function getUntaggedDockerIds(
  repo?: ?string,
  filter?: ?DockerImageFilter = null,
): Promise<string[]> {
  return (
    await dockerImages(
      repo,
      m =>
        m.tag === '<none>' && (typeof filter === 'function' ? filter(m) : true),
    )
  ).map(m => m.id);
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
      m =>
        (!id || m.id === id) &&
        (typeof filter === 'function' ? filter(m) : true),
    )
  ).map(m => (fullName ? `${m.repository}:${m.tag}` : m.tag));
}

export async function getDockerDigest(imageId: string, repo?: string) {
  return (await dockerImages(repo, m => m.id === imageId)).map(
    m => m.digest,
  )[0];
}

export async function dockerLogin(
  user: string,
  password: string,
  registry: string,
) {
  const reg = registry || getDockerConfig().registry;
  return spawn(
    'docker',
    ['login', '-u', user || '', '-p', password || '', ...(reg ? [reg] : [])],
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

export async function dockerRmi(
  images: string[] = [],
  ignoreErrors: boolean = true,
) {
  // must do these sequentially, or they will interfere with each other
  await images.reduce(async (prev, image) => {
    await prev;
    await spawn('docker', ['rmi', image], { stdio: 'inherit' }).catch(err => {
      if (!ignoreErrors) {
        throw err;
      }
    });
  }, Promise.resolve());
}

export function getDockerRepo() {
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

export type DockerNetwork = {
  id: string,
  name: string,
  driver: string,
  scope: string,
};

export async function dockerNetworks(): Promise<DockerNetwork[]> {
  return (await spawn('docker', ['network', 'ls'], {}, false, true))
    .split('\n')
    .slice(1)
    .map(l => {
      const [id, name, driver, scope] =
        // $FlowFixMe
        l.match(/^([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)/)?.slice(1) || [];
      return { id, name, driver, scope };
    })
    .filter(m => m != null);
}

export async function dockerNetworkFind(networkName: string) {
  return (await dockerNetworks()).find(
    n => n.name === networkName || n.id === networkName,
  );
}

export async function dockerNetworkCreate(networkName: string) {
  const existing = await dockerNetworkFind(networkName);
  if (existing) return existing;
  await spawn('docker', ['network', 'create', networkName]);
  return dockerNetworkFind(networkName);
}

export async function dockerNetworkDelete(networkName: string) {
  let existing;
  // eslint-disable-next-line no-cond-assign, no-await-in-loop
  while ((existing = await dockerNetworkFind(networkName))) {
    // eslint-disable-next-line no-await-in-loop
    await spawn('docker', ['network', 'rm', existing.id]);
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

export type PullAndRunContainerOptions = {
  runArgs?: string[],
  cmd?: string[],
  network?: ?string,
  alias?: ?string,
  offline?: boolean,
  testUrl?: ?string,
};

export async function dockerPullAndRunContainer(
  image: string,
  options: PullAndRunContainerOptions = {},
) {
  const {
    runArgs = [],
    cmd = [],
    network,
    alias,
    offline = process.argv.includes('--offline'),
    testUrl,
  } = options;

  try {
    if (offline || !(await isReachable(testUrl || 'https://hub.docker.com'))) {
      buildLog('It looks like you are offline, skipping docker pull');
    } else {
      await spawn('docker', ['pull', image], { stdio: 'inherit' });
    }
  } catch (err) {
    buildLog(`docker pull failed (${err.message}), attempting to continue...`);
  }
  const containerId = (
    await spawn(
      'docker',
      ['run', '--rm', '-d', ...runArgs, image, ...cmd],
      null,
      false,
      true,
    )
  ).trim();
  if (network) {
    await dockerNetworkConnect(network, containerId, alias);
  }
  return containerId;
}

export async function dockerTryStopContainer(id: ?string, name?: string = '') {
  if (id) {
    try {
      await spawn('docker', ['stop', id]);
    } catch (e) {
      buildLog(`Failed to stop ${name} container: ${e.message}`);
    }
  }
}
