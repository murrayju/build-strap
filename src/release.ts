import readline from 'readline/promises';
import semver from 'semver';

import { git, gitOutput } from './git.js';
import {
  getMainBranch,
  highestSemverTag,
  parseSemverTag,
  type SemverTag,
} from './version.js';

const incrementTypes = ['major', 'minor', 'patch', 'prerelease'] as const;
type IncrementType = (typeof incrementTypes)[number];

const isIncrementType = (value: string): value is IncrementType =>
  (incrementTypes as readonly string[]).includes(value);

export const releaseUsage = `Usage: ./bs release <major | minor | patch | prerelease | X.Y.Z[-id.N]> [--preid=<id>] [--dry-run]

Tags the current commit of the main branch with v<version> and pushes the tag.
The CI build of the tag then publishes the release.

  major | minor | patch   Increment the latest release tag by semver.
  prerelease              Increment to the next pre-release. After 1.2.3 this
                          gives 1.2.4-rc.0, then 1.2.4-rc.1.
  X.Y.Z | X.Y.Z-id.N      Use this version. It must be greater than the latest
                          release tag.
  --preid=<id>            The pre-release identifier for prerelease (default rc).
                          It is also the npm dist-tag of the pre-release.
  --dry-run               Show the plan, but do not create or push the tag.`;

/**
 * Compute the version to release from the latest released version.
 * @param latestVersion the highest released version, or null if there is none
 * @param versionArgument major, minor, patch, prerelease, or a version
 * @param preid the pre-release identifier for prerelease
 */
export function computeNextVersion(
  latestVersion: null | string,
  versionArgument: string,
  preid = 'rc',
): string {
  let nextVersion: null | string;
  if (isIncrementType(versionArgument)) {
    if (!latestVersion) {
      throw new Error(
        'There is no release tag to increment. Give a version, for example 1.0.0.',
      );
    }
    nextVersion = semver.inc(latestVersion, versionArgument, preid);
    if (!nextVersion) {
      throw new Error(
        `Cannot increment ${latestVersion} by ${versionArgument} with preid \`${preid}\`.`,
      );
    }
  } else {
    nextVersion = parseSemverTag(versionArgument)?.version ?? null;
    if (!nextVersion) {
      throw new Error(
        `Invalid version \`${versionArgument}\`.\n\n${releaseUsage}`,
      );
    }
  }
  // The first pre-release identifier becomes the npm dist-tag (see
  // getDefaultNpmDistTag). npm does not accept a number as a dist-tag.
  const prereleaseIds = semver.prerelease(nextVersion);
  if (prereleaseIds && typeof prereleaseIds[0] !== 'string') {
    throw new Error(
      `The pre-release of ${nextVersion} must start with a name (for example ${semver.major(nextVersion)}.${semver.minor(nextVersion)}.${semver.patch(nextVersion)}-rc.0), because it becomes the npm dist-tag.`,
    );
  }
  if (latestVersion && !semver.gt(nextVersion, latestVersion)) {
    throw new Error(
      `Version ${nextVersion} is not greater than the latest release ${latestVersion}.`,
    );
  }
  return nextVersion;
}

interface RemoteTag {
  commit: string;
  semverTag: SemverTag;
}

/**
 * Parse the output of `git ls-remote --tags` into the semver release tags. For
 * an annotated tag, the peeled `^{}` line gives the commit.
 */
function parseRemoteReleaseTags(lsRemoteOutput: string): RemoteTag[] {
  const commitsByTagName = new Map<string, string>();
  for (const line of lsRemoteOutput.split('\n')) {
    const [objectName, reference = ''] = line.trim().split(/\s+/);
    if (!objectName || !reference.startsWith('refs/tags/')) {
      continue;
    }
    const tagName = reference.slice('refs/tags/'.length);
    if (tagName.endsWith('^{}')) {
      commitsByTagName.set(tagName.slice(0, -'^{}'.length), objectName);
    } else if (!commitsByTagName.has(tagName)) {
      commitsByTagName.set(tagName, objectName);
    }
  }
  return [...commitsByTagName].flatMap(([tagName, commit]) => {
    const semverTag = parseSemverTag(tagName);
    return semverTag ? [{ commit, semverTag }] : [];
  });
}

async function confirm(question: string): Promise<boolean> {
  const prompt = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  // At the end of input, question() does not settle. Treat it as "no".
  const endOfInput = new Promise<string>((resolve) => {
    prompt.once('close', () => {
      resolve('');
    });
  });
  try {
    const answer = await Promise.race([
      prompt.question(`${question} [y/N] `),
      endOfInput,
    ]);
    return ['y', 'yes'].includes(answer.trim().toLowerCase());
  } finally {
    prompt.close();
  }
}

export interface ReleaseOptions {
  dryRun?: boolean;
  preid?: string;
  remote?: string;
}

/**
 * Cut a release: tag the current commit of the main branch with v<version>,
 * and push the tag. The CI build of the tag publishes the release. The latest
 * version is the highest semver tag on the remote.
 */
export async function release(
  versionArgument: string,
  { dryRun = false, preid = 'rc', remote = 'origin' }: ReleaseOptions = {},
): Promise<void> {
  const mainBranch = getMainBranch();
  await git(['fetch', '--quiet', remote, mainBranch], { stdio: 'inherit' });
  const headCommit = await gitOutput(['rev-parse', 'HEAD']);
  const currentBranch = await gitOutput(['symbolic-ref', '--short', 'HEAD'], {
    rejectOnErrorCode: false,
  });
  const remoteBranchCommit = await gitOutput([
    'rev-parse',
    `${remote}/${mainBranch}`,
  ]);
  // Untracked files cannot change the tagged commit, so ignore them.
  const uncommittedChanges = await gitOutput([
    'status',
    '--porcelain',
    '--untracked-files=no',
  ]);

  const problems: string[] = [];
  if (uncommittedChanges) {
    problems.push(
      'The working directory has changes to tracked files. Commit or stash them.',
    );
  }
  if (currentBranch !== mainBranch) {
    problems.push(
      `Check out \`${mainBranch}\` to release. The current branch is \`${currentBranch || '(detached HEAD)'}\`.`,
    );
  } else if (headCommit !== remoteBranchCommit) {
    problems.push(
      `Local \`${mainBranch}\` (${headCommit.slice(0, 9)}) is not the same as \`${remote}/${mainBranch}\` (${remoteBranchCommit.slice(0, 9)}). Push or pull first.`,
    );
  }
  if (problems.length) {
    throw new Error(
      `Cannot release:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`,
    );
  }

  // Use the remote tags: the remote is what CI and other developers see.
  const remoteTags = parseRemoteReleaseTags(
    await gitOutput(['ls-remote', '--tags', remote]),
  );
  const latestVersion =
    highestSemverTag(remoteTags.map(({ semverTag }) => semverTag))?.version ??
    null;
  const nextVersion = computeNextVersion(latestVersion, versionArgument, preid);
  const tagName = `v${nextVersion}`;

  const existingTag = remoteTags.find(
    ({ semverTag }) => semverTag.version === nextVersion,
  );
  if (existingTag) {
    throw new Error(
      `Version ${nextVersion} already has the tag \`${existingTag.semverTag.tag}\` on ${remote}.`,
    );
  }
  if (await gitOutput(['tag', '--list', tagName])) {
    throw new Error(
      `The tag ${tagName} already exists locally. Delete it with \`git tag -d ${tagName}\`, then try again.`,
    );
  }

  console.info(`Latest release: ${latestVersion ?? '(none)'}`);
  console.info(`New release:    ${nextVersion} (tag ${tagName})`);
  console.info(
    `Commit:         ${await gitOutput(['log', '-1', '--format=%h %s', 'HEAD'])}`,
  );
  // Finalizing a pre-release (for example 1.2.3-rc.0 to 1.2.3) on the same
  // commit is normal, so only a full release on HEAD gets a note.
  const fullReleasesOnHead = remoteTags.filter(
    ({ commit, semverTag }) => commit === headCommit && !semverTag.prerelease,
  );
  if (fullReleasesOnHead.length) {
    console.info(
      `\nNote: this commit is already released as ${fullReleasesOnHead
        .map(({ semverTag }) => semverTag.tag)
        .join(', ')}. The new release has the same code.`,
    );
  }
  console.info(
    `\nThis tags HEAD with ${tagName} and pushes the tag to ${remote}. The CI build of the tag publishes the release. You cannot undo a publish.`,
  );

  if (dryRun) {
    console.info('\nDry run: the tag was not created or pushed.');
    return;
  }
  if (!(await confirm('Continue?'))) {
    console.info('\nRelease canceled.');
    return;
  }

  await git(
    ['tag', '--annotate', tagName, '--message', nextVersion, headCommit],
    { stdio: 'inherit' },
  );
  try {
    await git(['push', '--quiet', remote, `refs/tags/${tagName}`], {
      stdio: 'inherit',
    });
  } catch (pushError) {
    // Show the push error, not an error from this cleanup.
    await git(['tag', '--delete', tagName], { rejectOnErrorCode: false });
    throw pushError;
  }
  console.info(`\nPushed ${tagName}. The CI build of the tag publishes it.`);
}
