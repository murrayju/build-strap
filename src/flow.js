// @flow
import { spawn } from './cp';

export type FlowOpts = {
  allBranches?: boolean,
  incremental?: boolean,
};

// Run the flow linter
export async function flow(opts?: FlowOpts) {
  const { allBranches = false, incremental = true } = opts || {};
  return spawn(
    'flow',
    [
      incremental ? 'status' : 'check',
      ...(allBranches ? ['--show-all-branches'] : []),
    ],
    { stdio: 'inherit', shell: true },
  );
}
