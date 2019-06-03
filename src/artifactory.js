// @flow
import path from 'path';
import fs from 'fs';
import rp from 'request-promise-native';
import moment from 'moment';
import { platform } from 'os';
import { writeFile } from './fs';
import { spawn } from './cp';
import { getCfg, getPkgName, getPkgScope } from './pkg';
import { getVersion, getReleaseBranch } from './version';
import { buildLog } from './run';
import type { ArtifactInfo } from './tgz';

export type ArtifactoryCreds = {
  username: string,
  password: string,
  email: string,
};

export type RemoteArtifactInfo = {
  uri: string,
  lastModified: string,
  repo: string,
  path: string,
  children: RemoteArtifactInfo[],
};

export type ArtifactoryConfig = {
  root: string,
  path?: string,
  'version-folders'?: boolean,
  release?: string,
  integration?: string,
  'integration-branch-folders'?: boolean,
  'integration-days-to-keep'?: number,
  'integration-max-to-keep'?: number,
  npm?: string,
  'npm-clean'?: string,
};

export function getArtifactoryConfig(): ArtifactoryConfig {
  return getCfg().artifactory || {};
}

const envArtifactoryCreds: ArtifactoryCreds = (process.env.ARTIFACTORY_CREDS &&
  JSON.parse(process.env.ARTIFACTORY_CREDS)) || {
  username: '',
  password: '',
  email: '',
};

// Properly insert credentials into request to artifactory api
export async function artifactoryRequest(
  requestOptions: any,
  artifactoryCreds?: ArtifactoryCreds,
) {
  const creds = artifactoryCreds || envArtifactoryCreds;
  return rp(requestOptions).auth(creds.username, creds.password);
}

// Send a file to artifactory by doing a http PUT to the given url(s), with the given credentials
// if artifactoryCreds are not provided, attempt to read from environment variable
export async function artifactoryPut(
  artifact: string | stream$Readable,
  url: string | string[],
  artifactInfo: ArtifactInfo,
  artifactoryCreds?: ArtifactoryCreds,
) {
  const stream: stream$Readable =
    typeof artifact === 'string' ? fs.createReadStream(artifact) : artifact;
  const urls = typeof url === 'string' ? [url] : url;

  return Promise.all(
    urls.map(uri =>
      artifactoryRequest(
        {
          method: 'PUT',
          uri,
          body: stream,
          headers: {
            'content-type': artifactInfo.contentType || 'application/gzip',
            'X-Checksum-Md5': artifactInfo.md5,
            'X-Checksum-Sha1': artifactInfo.sha1,
            'Content-Length': artifactInfo.size,
          },
        },
        artifactoryCreds,
      ).then(() => {
        buildLog(`Successful PUT to ${uri}`);
        return uri;
      }),
    ),
  );
}

export async function artifactoryDelete(
  url: string | string[],
  artifactoryCreds?: ArtifactoryCreds,
  dryRun: boolean = process.argv.includes('--dry-run'),
) {
  const urls = typeof url === 'string' ? [url] : url;
  if (dryRun) {
    buildLog('Skipping delete due to --dry-run');
    return null;
  }

  return Promise.all(
    urls.map(uri =>
      artifactoryRequest(
        {
          method: 'DELETE',
          uri,
        },
        artifactoryCreds,
      ).then(() => {
        buildLog(`Successful DELETE of ${uri}`);
        return uri;
      }),
    ),
  );
}

// Invokes `npm publish` on the distDir, using the given credentials and artifactory config
// artifactory config can be provided as arg, or in the package.json file
export async function artifactoryNpm(
  distDir: string,
  artifactoryConfig?: ArtifactoryConfig,
  artifactoryCreds?: ArtifactoryCreds,
  npmPath?: string,
  tag?: string,
  skipExisting: boolean = false,
) {
  const creds = artifactoryCreds || envArtifactoryCreds;
  const { root: rt, npm } = artifactoryConfig || getArtifactoryConfig();
  if (!rt || !npm) {
    buildLog(
      'npm artifactory info missing from package.json, skipping npm publish',
    );
    return false;
  }
  const existing = await getNpmArtifacts(false, artifactoryConfig, creds);
  const { isRelease, npm: npmVersion } = await getVersion();
  const regex = new RegExp(`${npmVersion}.tgz$`);
  const exists = !!existing.find(c => c.path.match(regex));
  if (exists) {
    if (skipExisting) {
      buildLog(
        'npm module with this same version already exists in artifactory. Skipping publish...',
      );
      return false;
    }
    throw new Error(
      'Failed to publish npm module, this version already exists in artifactory!',
    );
  }
  // Write out .npmrc with credentials
  await writeFile(
    path.join(distDir, '.npmrc'),
    `registry=${rt}api/npm/${npm}
_auth=${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}
always-auth=true
email=${creds.email}`,
  );
  await spawn(
    npmPath || (platform() === 'win32' ? 'npm.cmd' : 'npm'),
    ['publish', '--tag', tag || (isRelease ? 'latest' : 'next')],
    {
      stdio: 'inherit',
      cwd: distDir,
    },
  );
  return true;
}

async function standardUrl(
  fileName: string,
  artifactoryConfig?: ArtifactoryConfig,
) {
  const {
    root: rt,
    release,
    integration,
    path: aPath,
    'version-folders': versionFolders,
    'integration-branch-folders': intBrFolders,
  } = artifactoryConfig || getArtifactoryConfig();
  if (!rt || !release || !integration) {
    return false;
  }
  const version = await getVersion();
  const artPath = aPath || getPkgName();
  const versDir = versionFolders ? `/${version.info}` : '';
  if (version.isRelease) {
    return `${rt}${release}/${artPath}${versDir}/${fileName}`;
  }
  const branch = intBrFolders ? `/${version.branch}` : '';
  return `${rt}${integration}/${artPath}${branch}${versDir}/${fileName}`;
}

// Use the REST api to publish as a standard artifactory artifact
export async function artifactoryStandard(
  artifact: string | stream$Readable,
  artifactInfo: ArtifactInfo,
  fileName: string,
  artifactoryConfig?: ArtifactoryConfig,
  artifactoryCreds?: ArtifactoryCreds,
) {
  const url = await standardUrl(fileName, artifactoryConfig);
  if (!url) {
    buildLog(
      'release/integration artifactory info missing from package.json, skipping artifactory publish',
    );
    return false;
  }
  await artifactoryPut(artifact, url, artifactInfo, artifactoryCreds);
  return true;
}

const getRemoteArtifactInfo = async (
  rootUri: string,
  repo: string,
  subPath: string,
  artifactoryCreds?: ArtifactoryCreds,
): Promise<RemoteArtifactInfo> =>
  artifactoryRequest(
    {
      method: 'GET',
      uri: `${rootUri}/api/storage/${repo}/${subPath}`,
      json: true,
    },
    artifactoryCreds,
  );

const getRemoteArtifactChildrenInfo = async (
  info: RemoteArtifactInfo,
  rootUri: string,
  repo: string,
  subPath: string,
  artifactoryCreds?: ArtifactoryCreds,
) =>
  Promise.all(
    info.children.map(async c =>
      getRemoteArtifactInfo(
        rootUri,
        repo,
        `${subPath}${c.uri}`,
        artifactoryCreds,
      ),
    ),
  );

async function cleanChildren(
  rootUri: string,
  repo: string,
  subPath: string,
  daysToKeep: number = 14,
  maxToKeep: number = 10,
  keepFilter?: ?(child: RemoteArtifactInfo) => boolean,
  artifactoryCreds?: ArtifactoryCreds,
) {
  const info = await getRemoteArtifactInfo(
    rootUri,
    repo,
    subPath,
    artifactoryCreds,
  );
  const children = await getRemoteArtifactChildrenInfo(
    info,
    rootUri,
    repo,
    subPath,
    artifactoryCreds,
  );
  // Filter out children that we absolutely will not delete
  const integrationChildren = keepFilter
    ? children.filter(c => !keepFilter(c))
    : children;

  // Determine which integration artifacts to keep (they are recent and not too numerous)
  const timeThreshold = daysToKeep
    ? moment().subtract(daysToKeep, 'days')
    : null;
  const filtered = timeThreshold
    ? integrationChildren.filter(c =>
        moment(c.lastModified).isAfter(timeThreshold),
      )
    : integrationChildren;
  const limited = maxToKeep
    ? filtered
        .sort((a, b) => {
          const tA = moment(a.lastModified);
          const tB = moment(b.lastModified);
          if (tA.isBefore(tB)) {
            return -1;
          }
          if (tA.isAfter(tB)) {
            return 1;
          }
          return 0;
        })
        .slice(-maxToKeep)
    : filtered;

  // Delete any integration artifacts that didn't make the limited list
  return Promise.all(
    integrationChildren
      .filter(c => limited.indexOf(c) < 0)
      .map(async c => {
        buildLog(`Deleting artifact: ${c.repo}${c.path}`);
        await artifactoryDelete(
          `${rootUri}/${c.repo}/${c.path}`,
          artifactoryCreds,
        );
      }),
  );
}

async function cleanBranchFolders(
  rootUri: string,
  repo: string,
  subPath: string,
  daysToKeep?: number,
  maxToKeep?: number,
  keepFilter?: ?(child: RemoteArtifactInfo) => boolean,
  artifactoryCreds?: ArtifactoryCreds,
) {
  const info = await getRemoteArtifactInfo(
    rootUri,
    repo,
    subPath,
    artifactoryCreds,
  );
  const children = await getRemoteArtifactChildrenInfo(
    info,
    rootUri,
    repo,
    subPath,
    artifactoryCreds,
  );
  await Promise.all(
    children.map(async c => {
      const [branch] = c.path.split('/').slice(-1);
      if (branch === getReleaseBranch()) {
        buildLog(
          `Skipping cleanup of release branch: ${repo}/${subPath}/${branch}`,
        );
        return;
      }
      buildLog(`Cleaning integration branch: ${repo}/${subPath}/${branch}`);
      await cleanChildren(
        rootUri,
        c.repo,
        c.path,
        daysToKeep,
        maxToKeep,
        keepFilter,
        artifactoryCreds,
      );

      // if branch folder is now empty, delete it
      const cInfo = await getRemoteArtifactInfo(
        rootUri,
        c.repo,
        c.path,
        artifactoryCreds,
      );
      if (cInfo.children.length === 0) {
        buildLog(`Deleting empty branch folder: ${c.repo}/${c.path}`);
        await artifactoryDelete(
          `${rootUri}/${c.repo}/${c.path}`,
          artifactoryCreds,
        );
      }
    }),
  );
}

export async function artifactoryCleanup(
  daysToKeep?: number,
  maxToKeep?: number,
  artifactoryConfig?: ArtifactoryConfig,
  artifactoryCreds?: ArtifactoryCreds,
) {
  const {
    root: rt,
    'integration-days-to-keep': intDaysKeep,
    'integration-max-to-keep': intMaxKeep,
    integration,
    path: aPath,
    'integration-branch-folders': intBranchFolders,
    'npm-clean': npmClean,
  } = artifactoryConfig || getArtifactoryConfig();
  if (!rt) {
    buildLog(
      'artifactory info missing from package.json, skipping artifactory cleanup',
    );
    return false;
  }
  const dToK = daysToKeep == null ? intDaysKeep : daysToKeep;
  const mToK = maxToKeep == null ? intMaxKeep : maxToKeep;

  if (integration) {
    // Clean up integration repo artifacts
    const artPath = aPath || getPkgName();
    if (intBranchFolders) {
      await cleanBranchFolders(
        rt,
        integration,
        artPath,
        dToK,
        mToK,
        null,
        artifactoryCreds,
      );
    } else {
      await cleanChildren(
        rt,
        integration,
        artPath,
        dToK,
        mToK,
        null,
        artifactoryCreds,
      );
    }
  }

  if (npmClean) {
    // Clean up npm integration artifacts
    const name = getPkgName(false);
    const scope = getPkgScope();
    const releaseRegex = new RegExp(`${name}-\\d+\\.\\d+\\.\\d+\\.tgz`, 'i');
    await cleanChildren(
      rt,
      npmClean,
      scope ? `${scope}/${name}/-/${scope}` : `${name}/-`,
      dToK,
      mToK,
      c => !!c.path.match(releaseRegex),
      artifactoryCreds,
    );
  }
  return true;
}

function uniqBy<T>(a: T[], key: T => string): T[] {
  const seen = new Set();
  return a.filter((item: T) => {
    const k = key(item);
    return seen.has(k) ? false : seen.add(k);
  });
}

export async function getNpmArtifacts(
  releasedOnly: boolean = false,
  artifactoryConfig?: ArtifactoryConfig,
  artifactoryCreds?: ArtifactoryCreds,
) {
  const { root: rt, npm } = artifactoryConfig || getArtifactoryConfig();
  if (!rt || !npm) {
    throw new Error('artifactory info missing from package.json');
  }
  const name = getPkgName(false);
  const scope = getPkgScope();
  const npmPath = scope ? `${scope}/${name}/-/${scope}` : `${name}/-`;
  const releaseRegex = new RegExp(`${name}-\\d+\\.\\d+\\.\\d+\\.tgz`, 'i');
  try {
    const info = await getRemoteArtifactInfo(
      rt,
      npm,
      npmPath,
      artifactoryCreds,
    );
    const children = uniqBy(
      await getRemoteArtifactChildrenInfo(
        info,
        rt,
        npm,
        npmPath,
        artifactoryCreds,
      ),
      c => c.uri,
    );
    return releasedOnly
      ? // $FlowFixMe
        children.filter(c => !!c.path.match(releaseRegex))
      : children;
  } catch (err) {
    if (err.statusCode === 404) return [];
    throw err;
  }
}
