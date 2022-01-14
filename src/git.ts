import { spawn, SpawnOptions } from './cp.js';
import { userQuestion } from './prompt.js';
import { buildLog } from './run.js';

export const git = async (
  args: string[],
  opts?: SpawnOptions,
): Promise<string> =>
  (await spawn('git', args, { captureOutput: true, ...opts })).stdout.trim();

export async function gitBranch(): Promise<string> {
  return (await git(['symbolic-ref', '--short', 'HEAD']))
    .replace(/[_+/]/g, '-')
    .trim();
}

export async function gitRevId(): Promise<string> {
  return (await git(['rev-parse', '--short=12', 'HEAD']))
    .replace(/[+]/g, '')
    .trim();
}

type GitInfo = {
  branch: string;
  revision: string;
};

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
  await git(['lfs', 'install'], { stdio: 'inherit' });
};

export const gitConfigRead = async (key: string, global = true) =>
  git(['config', ...(global ? ['--global'] : []), key], {
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
