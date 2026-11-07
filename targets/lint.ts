import { buildLog, spawn } from '../src/index.js';

// Lint the source with oxlint, then format it with oxfmt
export default async function lint() {
  if (process.argv.includes('--no-lint')) {
    buildLog('Skipping due to --no-lint');
    return;
  }
  const autoFix = !process.argv.includes('--lint-no-fix');
  // Use the current node binary. The `node` shim that nub puts on the PATH
  // adds approximately 300 ms to each start.
  // Run the two tools also when one of them fails, to show all problems.
  const options = { rejectOnErrorCode: false, stdio: 'inherit' } as const;
  const { code: oxlintCode } = await spawn(
    process.execPath,
    ['node_modules/oxlint/bin/oxlint', ...(autoFix ? ['--fix'] : [])],
    options,
  );
  const { code: oxfmtCode } = await spawn(
    process.execPath,
    [
      'node_modules/oxfmt/bin/oxfmt',
      autoFix ? '--write' : '--check',
      'src',
      'targets',
    ],
    options,
  );
  if (oxlintCode || oxfmtCode) {
    throw new Error(
      `Linting failed (oxlint exit code ${oxlintCode}, oxfmt exit code ${oxfmtCode})`,
    );
  }
}
