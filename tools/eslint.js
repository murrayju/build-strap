// @flow
import { CLIEngine } from 'eslint';
import { buildLog, eslint } from '../src/index';

// Lint the source using eslint
export default async function runEslint() {
  if (process.argv.includes('--no-eslint')) {
    buildLog('Skipping due to --no-eslint');
    return null;
  }
  return eslint({ CLIEngine });
}
