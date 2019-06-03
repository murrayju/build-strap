// @flow
export function format(time?: Date = new Date()) {
  return time.toTimeString().replace(/.*(\d{2}:\d{2}:\d{2}).*/, '$1');
}

const silenceLogs = process.argv.includes('--silence-buildLog');

export function buildLog(msg: string, time?: Date) {
  if (silenceLogs) {
    return;
  }
  console.info(`[${format(time || new Date())}] ${msg}`);
}

export type RunnableModule = (() => any) | { default: () => any };

export async function run(fn: RunnableModule, ...options: any[]) {
  if (fn == null) {
    throw new Error(`Invalid argument passed to run(${fn})`);
  }
  const task = typeof fn === 'function' ? fn : fn.default;
  if (typeof task !== 'function') {
    throw new Error(
      'First argument to run must be a function or module with default function.',
    );
  }
  const start = new Date();
  buildLog(`Starting '${task.name}'...`, start);
  const result = await task(...options);
  const end = new Date();
  const time = end.getTime() - start.getTime();
  buildLog(`Finished '${task.name}' after ${time} ms`, end);
  return result;
}

export function runCli(
  resolveFn: (path: string) => RunnableModule = (path: string) =>
    // $FlowFixMe
    require(`./${path}`).default, // eslint-disable-line
  defaultAction: string | RunnableModule = 'publish',
  argv: string[] = process.argv,
  passthroughArgv: boolean = false,
) {
  const module =
    argv.length > 2
      ? resolveFn(argv[2])
      : typeof defaultAction === 'string'
      ? resolveFn(defaultAction)
      : defaultAction;
  const args = Array.isArray(passthroughArgv)
    ? passthroughArgv.includes(argv[2] || defaultAction)
      ? argv.slice(3)
      : []
    : passthroughArgv
    ? argv.slice(3)
    : [];
  return run(module, ...args).catch(err => {
    console.error((err && err.stack) || err);
    process.exit(1);
  });
}

if (require.main === module) {
  delete require.cache[__filename]; // eslint-disable-line no-underscore-dangle
  runCli();
}

export default run;
