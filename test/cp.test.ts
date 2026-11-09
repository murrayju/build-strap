import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Start a node process with piped stdio, so that the test can chain it. */
function nodeProcess(args: string[]) {
  return spawn(process.execPath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * A limit for each child process that runs a test script. A spawn that never
 * settles would otherwise keep the child alive after the test timed out.
 */
const CHILD_TIMEOUT_MS = 20_000;
const spawnModuleUrl = new URL('../src/cp.js', import.meta.url).href;

/**
 * Prints two stdout lines, with the second line split across two writes, and
 * one stderr line.
 */
const splitLineScript = `
  process.stdout.write('one\\ntw');
  setTimeout(() => {
    process.stdout.write('o\\n');
    process.stderr.write('oops\\n');
  }, 10);
`;

interface SpawnResult {
  stderr: string;
  stdout: string;
}

interface PipeScriptOptions {
  captureOutput?: boolean;
  outputPrefix?: string;
  pipeOutput?: boolean;
}

/**
 * Run a script that pipes the output of a child process to its own stdout.
 *
 * The spawn pipe writes to `process.stdout` directly, so the test must inspect
 * the output of a separate process to see the result.
 */
async function runPipeScript(
  spawnOptions: PipeScriptOptions,
  childScript = splitLineScript,
): Promise<{ result: SpawnResult; stderr: string; stdout: string }> {
  const source = `
    import { spawn } from ${JSON.stringify(spawnModuleUrl)};
    const result = await spawn(
      process.execPath,
      ['-e', ${JSON.stringify(childScript)}],
      ${JSON.stringify(spawnOptions)},
    );
    process.stdout.write('RESULT:' + JSON.stringify(result));
  `;
  const { stderr, stdout } = await execFileAsync(
    process.execPath,
    ['--input-type=module', '-e', source],
    { timeout: CHILD_TIMEOUT_MS },
  );
  const markerIndex = stdout.lastIndexOf('RESULT:');
  const result = JSON.parse(
    stdout.slice(markerIndex + 'RESULT:'.length),
  ) as SpawnResult;
  return {
    result,
    stderr,
    stdout: stdout.slice(0, markerIndex),
  };
}

/** A script that prints three lines slowly, so that output streams overlap. */
function slowLinesScript(label: string): string {
  return `
    for (let index = 0; index < 3; index++) {
      process.stdout.write('${label}' + index + '\\n');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  `;
}

void describe('spawn outputPrefix', () => {
  void it('adds the prefix to each piped line and captures raw output', async () => {
    const { result, stdout } = await runPipeScript({
      captureOutput: true,
      outputPrefix: 'job: ',
      pipeOutput: true,
    });

    // The prefix is added to complete lines only. A line that arrives in two
    // chunks stays one line.
    assert.equal(stdout, 'job: one\njob: two\n');

    // Captured output is raw, so that callers can still parse it.
    assert.equal(result.stdout, 'one\ntwo\n');
    assert.equal(result.stderr, 'oops\n');
  });

  void it('adds the prefix to stderr', async () => {
    const { stderr } = await runPipeScript(
      { outputPrefix: 'job: ', pipeOutput: true },
      `process.stderr.write('bad\\n')`,
    );

    assert.equal(stderr, 'job: bad\n');
  });

  void it('adds the prefix when output is not captured', async () => {
    const { result, stdout } = await runPipeScript({
      outputPrefix: 'job: ',
      pipeOutput: true,
    });

    assert.equal(stdout, 'job: one\njob: two\n');
    assert.equal(result.stdout, '');
  });

  void it('writes partial lines when the child exits without a newline', async () => {
    const { stdout } = await runPipeScript(
      { outputPrefix: 'job: ', pipeOutput: true },
      `process.stdout.write('partial')`,
    );

    assert.equal(stdout, 'job: partial');
  });

  void it('keeps a character that is split across chunks intact', async () => {
    const childScript = `
      process.stdout.write(Buffer.from([0xc3]));
      setTimeout(() => process.stdout.write(Buffer.from([0xa9, 0x0a])), 10);
    `;
    const { stdout } = await runPipeScript(
      { outputPrefix: 'job: ', pipeOutput: true },
      childScript,
    );

    assert.equal(stdout, 'job: \u00e9\n');
  });

  void it('adds the prefix after a carriage return', async () => {
    const { stdout } = await runPipeScript(
      { outputPrefix: 'job: ', pipeOutput: true },
      `process.stdout.write('10%\\r50%\\r\\n')`,
    );

    assert.equal(stdout, 'job: 10%\rjob: 50%\r\n');
  });

  void it('keeps a line break that is split across chunks whole', async () => {
    const { stdout } = await runPipeScript(
      { outputPrefix: 'job: ', pipeOutput: true },
      `
        process.stdout.write('a\\r');
        setTimeout(() => process.stdout.write('\\nb\\n'), 10);
      `,
    );

    assert.equal(stdout, 'job: a\r\njob: b\n');
  });

  void it('settles when the command does not exist', async () => {
    const source = `
      import { spawn } from ${JSON.stringify(spawnModuleUrl)};
      await spawn('build-strap-no-such-command', [], {
        outputPrefix: 'job: ',
        pipeOutput: true,
      }).then(
        () => process.stdout.write('resolved'),
        (error) => process.stdout.write('rejected: ' + error.code),
      );
    `;
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      source,
    ]);

    assert.equal(stdout, 'rejected: ENOENT');
  });

  void it('settles when the command is killed', async () => {
    const source = `
      import { spawn } from ${JSON.stringify(spawnModuleUrl)};
      const result = await spawn(
        process.execPath,
        ['-e', ${JSON.stringify(`
          process.stdout.write('started\\n');
          process.kill(process.pid, 'SIGKILL');
        `)}],
        { outputPrefix: 'job: ', pipeOutput: true, rejectOnErrorCode: false },
      );
      process.stdout.write('signal: ' + result.signal);
    `;
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      source,
    ]);

    assert.equal(stdout, 'job: started\nsignal: SIGKILL');
  });

  void it('writes the last line before the caller continues', async () => {
    const source = `
      import { spawn } from ${JSON.stringify(spawnModuleUrl)};
      await spawn(
        process.execPath,
        ['-e', ${JSON.stringify(`process.stdout.write('last')`)}],
        { outputPrefix: 'job: ', pipeOutput: true },
      );
      process.stdout.write(' after');
    `;
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      source,
    ]);

    assert.equal(stdout, 'job: last after');
  });

  void it('passes stdin to the child when only the output is piped', async () => {
    // A child that reads stdin to the end must finish. A pipe that is never
    // closed would make it wait forever. The test closes the stdin of its own
    // process, and the child inherits that stdin.
    const source = `
      import { spawn } from ${JSON.stringify(spawnModuleUrl)};
      await spawn(
        process.execPath,
        ['-e', ${JSON.stringify(`
          process.stdin.on('end', () => process.stdout.write('stdin ended\\n'));
          process.stdin.resume();
        `)}],
        { outputPrefix: 'job: ', pipeOutput: true },
      );
    `;
    const child = execFile(
      process.execPath,
      ['--input-type=module', '-e', source],
      { timeout: CHILD_TIMEOUT_MS },
    );
    assert.ok(child.stdout);
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stdin?.end();
    await new Promise<void>((resolve, reject) => {
      child.once('close', resolve);
      child.once('error', reject);
    });

    assert.equal(stdout, 'job: stdin ended\n');
  });

  void it('settles when the destination of the piped output fails', async () => {
    // Closing the read end of the parent output, as `head -1` does, makes the
    // parent see EPIPE on stdout. The child keeps writing, so the spawn must
    // still settle.
    const source = `
      import { spawn } from ${JSON.stringify(spawnModuleUrl)};
      process.stdout.on('error', () => {});
      await spawn(
        process.execPath,
        ['-e', ${JSON.stringify(`
          for (let index = 0; index < 200000; index++) {
            process.stdout.write('line ' + index + '\\n');
          }
        `)}],
        { outputPrefix: 'job: ', pipeOutput: true },
      );
      process.stderr.write('settled');
    `;
    const child = execFile(
      process.execPath,
      ['--input-type=module', '-e', source],
      { timeout: CHILD_TIMEOUT_MS },
    );
    assert.ok(child.stdout);
    // Close the pipe after the first line, to cause EPIPE in the parent.
    child.stdout.once('data', () => {
      child.stdout?.destroy();
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    await new Promise<void>((resolve, reject) => {
      child.once('close', resolve);
      child.once('error', reject);
    });

    assert.equal(stderr, 'settled');
  });

  void it('settles when a parallel command finishes first', async () => {
    // The destination unpipes every stream that ends, so a spawn must ignore
    // the unpipe events of the other spawns.
    const source = `
      import { spawn } from ${JSON.stringify(spawnModuleUrl)};
      process.stdout.on('error', () => {});
      const quiet = ['-e', ${JSON.stringify(`
        for (let index = 0; index < 5; index++) {
          process.stdout.write('quiet ' + index + '\\n');
        }
      `)}];
      const loud = ['-e', ${JSON.stringify(`
        await new Promise((resolve) => setTimeout(resolve, 50));
        for (let index = 0; index < 200000; index++) {
          process.stdout.write('loud ' + index + '\\n');
        }
      `)}];
      await Promise.all([
        spawn(process.execPath, quiet, { outputPrefix: 'q: ', pipeOutput: true }),
        spawn(process.execPath, loud, { outputPrefix: 'l: ', pipeOutput: true }),
      ]);
      process.stderr.write('settled');
    `;
    const child = execFile(
      process.execPath,
      ['--input-type=module', '-e', source],
      { timeout: CHILD_TIMEOUT_MS },
    );
    assert.ok(child.stdout);
    // The quiet command ends first. Close the parent output after that, while
    // the loud command is still writing.
    let sawQuiet = false;
    child.stdout.on('data', (chunk: Buffer) => {
      if (!sawQuiet && chunk.toString().includes('q: quiet 4')) {
        sawQuiet = true;
        setTimeout(() => {
          child.stdout?.destroy();
        }, 80);
      }
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    await new Promise<void>((resolve, reject) => {
      child.once('close', resolve);
      child.once('error', reject);
    });

    assert.equal(stderr, 'settled');
  });

  void it('keeps the listener count low for parallel commands', async () => {
    // Each command must not add listeners to the shared output stream, because
    // Node warns when a stream has more than 10.
    const source = `
      import { spawn } from ${JSON.stringify(spawnModuleUrl)};
      const jobs = [];
      for (let index = 0; index < 20; index++) {
        jobs.push(
          spawn(process.execPath, ['-e', 'process.stdout.write(\\'x\\\\n\\')'], {
            outputPrefix: 'job ' + index + ': ',
            pipeOutput: true,
          }),
        );
      }
      await Promise.all(jobs);
    `;
    const { stderr } = await execFileAsync(
      process.execPath,
      ['--input-type=module', '-e', source],
      { timeout: CHILD_TIMEOUT_MS },
    );

    assert.equal(stderr.includes('MaxListenersExceededWarning'), false);
  });

  void it('loses no output when the reader is slow', async () => {
    // A slow reader creates real backpressure on the output pipe. All output
    // must still arrive, and no command may stall or drop data.
    const writerScript = `
      import { spawn } from ${JSON.stringify(spawnModuleUrl)};
      const jobs = [];
      for (let index = 0; index < 20; index++) {
        jobs.push(
          spawn(
            process.execPath,
            [
              '-e',
              ${JSON.stringify(
                "for (let i = 0; i < 400; i++) process.stdout.write('LINE\\n')",
              )},
            ],
            { outputPrefix: 'job: ', pipeOutput: true },
          ),
        );
      }
      await Promise.all(jobs);
    `;
    const readerScript = `
      let bytes = 0;
      process.stdin.on('data', (chunk) => {
        bytes += chunk.length;
        process.stdin.pause();
        setTimeout(() => process.stdin.resume(), 2);
      });
      process.stdin.on('end', () => {
        process.stdout.write(JSON.stringify({ bytes }));
      });
      process.stdin.on('error', () => {});
      process.stdin.resume();
    `;
    // Use spawn, not execFile: execFile reads its own stdout, so it cannot be
    // piped into another process.
    const writer = nodeProcess(['--input-type=module', '-e', writerScript]);
    const reader = nodeProcess(['-e', readerScript]);
    writer.stdout.pipe(reader.stdin);
    let readerOutput = '';
    reader.stdout.on('data', (chunk: Buffer) => {
      readerOutput += chunk.toString();
    });
    // `end` is called when the piped output is fully written, not when the
    // writer exits, so wait for the pipe to finish before closing the reader.
    await new Promise<void>((resolve, reject) => {
      writer.stdout.once('end', resolve);
      writer.once('error', reject);
    });
    await new Promise<void>((resolve, reject) => {
      writer.once('close', resolve);
      writer.once('error', reject);
    });
    reader.stdin.end();
    await new Promise<void>((resolve, reject) => {
      reader.once('close', resolve);
      reader.once('error', reject);
    });

    // 20 commands, each 400 lines of "job: LINE".
    const expectedBytes = 20 * 400 * 'job: LINE\n'.length;
    assert.deepEqual(JSON.parse(readerOutput), { bytes: expectedBytes });
  });

  void it('settles when the source closes without ending', async () => {
    // A killed command can close its output without ending the stream. The
    // forwarding must still settle.
    const source = `
      import { spawn } from ${JSON.stringify(spawnModuleUrl)};
      const started = await spawn(
        process.execPath,
        ['-e', ${JSON.stringify(`
          const timer = setInterval(
            () => process.stdout.write('x'.repeat(1000) + '\\n'),
            1,
          );
          setTimeout(() => {
            clearInterval(timer);
            process.kill(process.pid, 'SIGKILL');
          }, 200);
        `)}],
        { outputPrefix: 'job: ', pipeOutput: true, rejectOnErrorCode: false },
      );
      process.stderr.write('settled signal=' + started.signal);
    `;
    const child = execFile(
      process.execPath,
      ['--input-type=module', '-e', source],
      { maxBuffer: 64 * 1024 * 1024, timeout: CHILD_TIMEOUT_MS },
    );
    child.stdout?.resume();
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    await new Promise<void>((resolve, reject) => {
      child.once('close', resolve);
      child.once('error', reject);
    });

    assert.equal(stderr, 'settled signal=SIGKILL');
  });

  void it('settles after an earlier command broke the output', async () => {
    // An earlier EPIPE leaves `process.stdout` in the `needDrain` state. A
    // later prefixed command must not wait for a `drain` event that never
    // comes.
    const source = `
      import { spawn } from ${JSON.stringify(spawnModuleUrl)};
      process.stdout.on('error', () => {});
      // Fill the pipe and let the reader close it, to reach EPIPE.
      const big = 'x'.repeat(512 * 1024);
      for (let index = 0; index < 40; index++) {
        process.stdout.write(big);
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (!process.stdout.writableNeedDrain) {
        process.stderr.write('no backpressure; test cannot run');
        process.exit(2);
      }
      // More output than the prefix stream and the pipe can hold.
      await spawn(
        process.execPath,
        ['-e', "process.stdout.write('y'.repeat(300000))"],
        { outputPrefix: 'job: ', pipeOutput: true },
      );
      process.stderr.write('settled');
    `;
    const child = execFile(
      process.execPath,
      ['--input-type=module', '-e', source],
      { timeout: CHILD_TIMEOUT_MS },
    );
    assert.ok(child.stdout);
    // Read one line, then close the pipe, so the parent sees EPIPE.
    child.stdout.once('data', () => {
      child.stdout?.destroy();
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    await new Promise<void>((resolve, reject) => {
      child.once('close', resolve);
      child.once('error', reject);
    });

    assert.equal(stderr, 'settled');
  });

  void it('leaves output unchanged when no prefix is set', async () => {
    const { stdout } = await runPipeScript({
      captureOutput: true,
      pipeOutput: true,
    });

    assert.equal(stdout, 'one\ntwo\n');
  });

  void it('keeps the output of parallel commands apart', async () => {
    const commands = [
      { outputPrefix: 'a: ', script: slowLinesScript('a') },
      { outputPrefix: 'b: ', script: slowLinesScript('b') },
    ];
    const source = `
      import { spawn } from ${JSON.stringify(spawnModuleUrl)};
      const commands = ${JSON.stringify(commands)};
      await Promise.all(
        commands.map(({ outputPrefix, script }) =>
          spawn(process.execPath, ['-e', script], {
            outputPrefix,
            pipeOutput: true,
          }),
        ),
      );
    `;
    const { stdout } = await execFileAsync(process.execPath, [
      '--input-type=module',
      '-e',
      source,
    ]);

    const lines = stdout.split('\n').filter(Boolean).sort();
    assert.deepEqual(lines, [
      'a: a0',
      'a: a1',
      'a: a2',
      'b: b0',
      'b: b1',
      'b: b2',
    ]);
  });
});
