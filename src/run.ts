export function format(time: Date = new Date()): string {
  return time.toTimeString().replace(/.*(\d{2}:\d{2}:\d{2}).*/, '$1');
}

const silenceLogs = process.argv.includes('--silence-buildLog');

/**
 * Where `buildLog` output should be written. Either the name of one of the
 * standard streams, any writable stream, or a function that receives the
 * fully formatted message.
 */
export type BuildLogStream =
  'stderr' | 'stdout' | NodeJS.WritableStream | ((msg: string) => void);

export interface BuildLogOptions {
  /** Override the destination for this message only. */
  stream?: BuildLogStream;
  /** Timestamp to prefix the message with (defaults to now). */
  time?: Date;
}

// stderr by default, so that stdout can be used for machine readable output.
let defaultStream: BuildLogStream = process.argv.includes('--buildLog-stdout')
  ? 'stdout'
  : 'stderr';

/** Change the destination used by `buildLog` when none is specified. */
export function setBuildLogStream(stream: BuildLogStream): void {
  defaultStream = stream;
}

/** The destination currently used by `buildLog` when none is specified. */
export function getBuildLogStream(): BuildLogStream {
  return defaultStream;
}

function writeLog(msg: string, stream: BuildLogStream): void {
  if (typeof stream === 'function') {
    stream(msg);
  } else if (stream === 'stdout') {
    process.stdout.write(`${msg}\n`);
  } else if (stream === 'stderr') {
    process.stderr.write(`${msg}\n`);
  } else {
    stream.write(`${msg}\n`);
  }
}

export function buildLog(
  msg: string,
  timeOrOptions?: BuildLogOptions | Date,
): void {
  if (silenceLogs) {
    return;
  }
  const { stream = defaultStream, time } =
    timeOrOptions instanceof Date
      ? { time: timeOrOptions }
      : (timeOrOptions ?? {});
  writeLog(`[${format(time || new Date())}] ${msg}`, stream);
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
  argv = process.argv,
  defaultAction = 'build',
  passthroughArgv = false,
  resolveFn = async (path: string) => import(`./${path}.js`),
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
