import { run, buildLog } from '../src/index';
import eslint from './eslint';
import flow from './flow';

// Lint the source using multiple linters
export default async function lint() {
  if (process.argv.includes('--lint-skip')) {
    buildLog('Skipping due to --lint-skip');
    return;
  }
  await run(eslint);
  await run(flow);
}
