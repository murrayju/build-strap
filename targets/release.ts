import { release, releaseUsage } from '../src/index.js';

// Cut a release: ./bs release <major | minor | patch | prerelease | version>
export default async function runRelease(...args: string[]) {
  const options = args.filter((arg) => arg.startsWith('-'));
  const positionals = args.filter((arg) => !arg.startsWith('-'));
  if (options.includes('-h') || options.includes('--help')) {
    console.info(releaseUsage);
    return;
  }
  const unknownOption = options.find(
    (option) => option !== '--dry-run' && !option.startsWith('--preid='),
  );
  if (unknownOption || positionals.length !== 1) {
    throw new Error(
      `${unknownOption ? `Unknown option \`${unknownOption}\`.\n\n` : ''}${releaseUsage}`,
    );
  }
  await release(positionals[0], {
    dryRun: options.includes('--dry-run'),
    preid: options
      .find((option) => option.startsWith('--preid='))
      ?.slice('--preid='.length),
  });
}
