import { createRequire } from 'module';

import { run, runCli, setPkg } from '../src/index.js';

const require = createRequire(import.meta.url);

setPkg(require('../package.json'));

void runCli({ resolveFn: async (path: string) => import(`./${path}.ts`) });

export default run;
