// @flow
import { buildLog, flow as execFlow } from '../src/index';

// Run the flow linter
export default async function flow({
  allBranches = process.argv.includes('--flow-all-branches'),
  incremental = !process.argv.includes('--flow-full-check'),
  skip = process.argv.includes('--flow-skip'),
}: {
  allBranches?: boolean,
  incremental?: boolean,
  skip?: boolean,
} = {}) {
  if (skip) {
    buildLog('Skipping due to --flow-skip');
    return;
  }
  await execFlow({ allBranches, incremental });
}
