import { spawn, SpawnOptions } from './cp.js';
import { userQuestion } from './prompt.js';
import { buildLog } from './run.js';

export const git = async (args: string[], opts?: SpawnOptions) =>
  spawn('git', args, opts);

export const gitOutput = async (
  args: string[],
  opts?: SpawnOptions,
): Promise<string> =>
  (await git(args, { captureOutput: true, ...opts })).stdout.trim();

/**
 * Convert a git ref name into a string that is safe to embed in a version.
 */
export function sanitizeGitRefName(refName: string): string {
  return refName.replace(/[_+/]/g, '-').trim();
}

/**
 * Name of the branch that is currently checked out, or `null` when the working
 * copy is in a detached HEAD state (as is typical for tag and pull request
 * builds on CI) and no branch name can be determined from the environment.
 */
export async function gitBranch(): Promise<null | string> {
  const checkedOutBranch = await gitOutput(
    ['symbolic-ref', '--short', 'HEAD'],
    {
      rejectOnErrorCode: false,
    },
  );
  if (checkedOutBranch) {
    return sanitizeGitRefName(checkedOutBranch);
  }
  // Detached HEAD: fall back to the branch reported by the CI environment.
  // For pull requests, GITHUB_HEAD_REF holds the source branch of the PR.
  const { GITHUB_HEAD_REF, GITHUB_REF } = process.env;
  const envBranch =
    GITHUB_HEAD_REF || GITHUB_REF?.match(/^refs\/heads\/(.+)$/)?.[1];
  return envBranch ? sanitizeGitRefName(envBranch) : null;
}

export async function gitRevId(): Promise<string> {
  return (await gitOutput(['rev-parse', '--short=12', 'HEAD']))
    .replace(/[+]/g, '')
    .trim();
}

/**
 * All tags that point directly at the given commit (HEAD by default).
 */
export async function gitTagsAtCommit(commitish = 'HEAD'): Promise<string[]> {
  const output = await gitOutput(['tag', '--points-at', commitish], {
    rejectOnErrorCode: false,
  });
  return output.split('\n').filter(Boolean);
}

/**
 * True when `ancestorCommitish` is reachable from `descendantCommitish`.
 * Useful for verifying that a release tag lives on the main branch.
 */
export async function gitIsAncestor(
  ancestorCommitish: string,
  descendantCommitish: string,
): Promise<boolean> {
  return (
    (
      await git(
        ['merge-base', '--is-ancestor', ancestorCommitish, descendantCommitish],
        { rejectOnErrorCode: false },
      )
    ).code === 0
  );
}

interface GitInfo {
  branch: null | string;
  revision: string;
}

let info: null | GitInfo = null;
export async function gitInfo(noCache = false): Promise<GitInfo> {
  if (!info || noCache) {
    info = {
      branch: await gitBranch(),
      revision: await gitRevId(),
    };
  }
  return info;
}

export const ensureGitLfsInstalled = async () => {
  await git(['lfs', 'install']);
};

export const gitConfigRead = async (key: string, global = true) =>
  gitOutput(['config', ...(global ? ['--global'] : []), key], {
    rejectOnErrorCode: false,
  });

export const gitConfigWrite = async (
  key: string,
  value: string,
  global = true,
) => {
  await git(['config', ...(global ? ['--global'] : []), key, value]);
};

export const ensureGitConfigUserEmail = async (
  emailRegex = /.+@.+/,
  emailPrompt = 'Enter your email address: ',
  global = true,
) => {
  const existing = await gitConfigRead('user.email', global);
  if (emailRegex.test(existing)) {
    return;
  }
  buildLog('Setting up git user config...');
  const name = await userQuestion('Enter your full name: ');
  await gitConfigWrite('user.name', name, global);
  const email = await userQuestion(emailPrompt, (input) =>
    emailRegex.test(input),
  );
  await gitConfigWrite('user.email', email, global);
};
