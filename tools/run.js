import pkg from '../package.json';
import { run, handleEntryPoint, setPkg } from '../src/index';

setPkg(pkg);
handleEntryPoint(module, __filename, {
  // eslint-disable-next-line import/no-dynamic-require,global-require
  resolveFn: (path) => require(`./${path}`).default,
});

export default run;
