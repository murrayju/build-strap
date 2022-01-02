export function format(time: Date = new Date()): string {
  return time.toTimeString().replace(/.*(\d{2}:\d{2}:\d{2}).*/, '$1');
}

const silenceLogs = process.argv.includes('--silence-buildLog');

export function buildLog(msg: string, time?: Date) {
  if (silenceLogs) {
    return;
  }
  console.info(`[${format(time || new Date())}] ${msg}`);
}

export type RunnableModule<Args extends string[], Result> =
  | ((...args: Args) => Promise<Result>)
  | { default: (...args: Args) => Promise<Result> };

export async function run<Args extends string[], Result>(
  fn: RunnableModule<Args, Result>,
  ...options: Args
): Promise<Result> {
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

export interface RunCliOptions<Args extends string[], Result> {
  argv?: string[];
  defaultAction?: string | RunnableModule<Args, Result>;
  passthroughArgv?: Args | boolean;
  resolveFn?: (
    path: string,
  ) => Promise<RunnableModule<Args, Result>> | RunnableModule<Args, Result>;
}

export async function runCli<Args extends string[], Result>({
  resolveFn = async (path: string) => import(`./${path}.js`),
  defaultAction = 'publish',
  argv = process.argv,
  passthroughArgv = false,
}: RunCliOptions<Args, Result> = {}): Promise<Result> {
  const module =
    argv.length > 2
      ? await resolveFn(argv[2])
      : typeof defaultAction === 'string'
      ? await resolveFn(defaultAction)
      : defaultAction;
  const args = Array.isArray(passthroughArgv)
    ? passthroughArgv.includes(argv[2] || (defaultAction as string))
      ? argv.slice(3)
      : []
    : passthroughArgv
    ? argv.slice(3)
    : [];
  return run(module, ...(args as Args)).catch((err) => {
    console.error((err && err.stack) || err);
    process.exit(1);
  });
}
