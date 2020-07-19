// @flow
import { spawn } from './cp';

export type FlowOptions = {|
  allBranches?: boolean,
  incremental?: boolean,
|};

// Run the flow linter
export async function flow(opts?: FlowOptions) {
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
