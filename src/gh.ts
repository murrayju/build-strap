import fs from 'fs-extra';
import path from 'path';

import { spawn, SpawnOptions } from './cp.js';
import { buildLog } from './run.js';
import { ensureSshKeyGenerated } from './ssh.js';

export const gh = async (args: string[], options?: SpawnOptions) =>
  spawn('gh', args, options);

export const ghRepoClone = async (repo: string, repoDir: string) => {
  await gh(['repo', 'clone', repo, repoDir], {
    stdio: 'inherit',
  });
};

export const ensureGhRepo = async (
  repo: string,
  {
    rootDir = '.',
    targetDir,
    targetName,
  }: {
    rootDir?: string;
    targetDir?: string;
    targetName?: string;
  } = {},
) => {
  const repoDir =
    targetDir ||
    path.join(rootDir, targetName || repo.split('/').pop() || repo);
  if (!(await fs.pathExists(repoDir))) {
    buildLog(`${repo} not found, cloning into ${repoDir}...`);
    await ghRepoClone(repo, repoDir);
  }
};

export const ensureGhAuthLogin = async ({
  host = 'github.com',
  scopes,
}: {
  host?: string;
  scopes?: string;
} = {}) => {
  const configured =
    (await gh(['auth', 'status'], { rejectOnErrorCode: false })).code === 0;
  if (!configured) {
    buildLog('Logging in to GitHub...');
    await gh(
      ['auth', 'login', '-h', host, '-w', ...(scopes ? ['-s', scopes] : [])],
      {
        stdio: 'inherit',
      },
    );
  }
};

export const ensureGhSshKeyAdded = async ({
  keyTitle,
  privateKeyPath,
}: {
  keyTitle?: string;
  privateKeyPath?: string;
} = {}) => {
  let listResult = await gh(['ssh-key', 'list'], {
    captureOutput: true,
    rejectOnErrorCode: false,
  });
  if (listResult.code !== 0) {
    // Probably don't have the scope
    buildLog('Adding admin:public_key scope to GitHub cli...');
    await gh(['auth', 'refresh', '-s', 'admin:public_key'], {
      stdio: 'inherit',
    });
    listResult = await gh(['ssh-key', 'list'], {
      captureOutput: true,
    });
  }
  const pubKeyPath = `${await ensureSshKeyGenerated(privateKeyPath)}.pub`;
  const pubKey = await fs.readFile(pubKeyPath, 'utf8');
  const existing = listResult.output.split('\n').find((line) => {
    const [, key] = line.split('\t');
    return pubKey.includes(key);
  });
  if (!existing) {
    buildLog('Adding SSH key to GitHub...');
    await spawn(
      'gh',
      ['ssh-key', 'add', pubKeyPath, ...(keyTitle ? ['-t', keyTitle] : [])],
      {
        stdio: 'inherit',
      },
    );
  }
};

export const ensureGhConfig = async (
  key: string,
  value: string,
  host = 'github.com',
) => {
  await gh(['config', 'set', '-h', host, key, value]);
};

export const ensureGhConfigSshGitProtocol = async (host = 'github.com') =>
  ensureGhConfig('git_protocol', 'ssh', host);
