// @flow
import { run, buildLog } from './run';
import { onKillSignal } from './cp';

export async function karmaTest(
  karma: Object,
  karmaConfig: any,
  preTestFn?: () => any,
  watch: boolean = process.argv.includes('--watch'),
) {
  // Lazy require karma
  const { Server, runner, stopper, config } = karma;

  const testConfig = config.parseConfig(karmaConfig, {
    autoWatch: false,
    singleRun: !watch,
  });
  const server = new Server(testConfig, (exitCode) => {
    buildLog(`Karma has exited with code ${exitCode}`);
  });
  onKillSignal(() => stopper.stop(testConfig));

  let started = false;
  async function doTest() {
    if (!started) {
      await Promise.all([
        new Promise((resolve) => {
          server.on('browsers_ready', resolve);
        }),
        server.start(),
      ]);
      started = true;
    }
    if (watch) {
      // await server.refreshFiles();
      await new Promise((resolve, reject) => {
        runner.run(testConfig, (exitCode) => {
          buildLog(`Karma run completed with exit code ${exitCode}`);
          if (exitCode === 0 || watch) {
            resolve(exitCode);
          } else {
            reject(exitCode);
          }
        });
      });
    }
  }

  if (typeof preTestFn === 'function') {
    // preTestFn is expected to callback and run doTest
    await run(preTestFn, doTest);
  } else {
    await doTest();
  }
}
