import { createRequire } from 'module';

import {
  type PackageJson,
  run,
  runCli,
  type RunnableModule,
  setPkg,
} from '../src/index.js';

const require = createRequire(import.meta.url);

setPkg(require('../package.json') as PackageJson);

void runCli({
  resolveFn: async (path: string) =>
    import(`./${path}.ts`) as Promise<RunnableModule<string[], unknown>>,
});

export default run;
