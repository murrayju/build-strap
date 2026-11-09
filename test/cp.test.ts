import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
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
  const { stderr, stdout } = await execFileAsync(process.execPath, [
    '--input-type=module',
    '-e',
    source,
  ]);
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
