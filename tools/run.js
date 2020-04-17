import pkg from '../package.json';
import { run, runCli, setPkg } from '../src/index';

setPkg(pkg);

if (require.main === module) {
  delete require.cache[__filename]; // eslint-disable-line no-underscore-dangle
  // eslint-disable-next-line global-require, import/no-dynamic-require
  runCli((path) => require(`./${path}`).default);
}

export default run;
