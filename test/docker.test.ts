import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  classifyDockerInfo,
  dockerIsRunning,
  ensureDockerRunning,
  waitForDockerToStart,
} from '../src/docker.js';

// Output from `docker info` when the daemon is reachable.
const clientInfo = `Client:
 Context:    default
 Debug Mode: false
 Plugins:
  buildx: Docker Buildx (Docker Inc., v0.9.1)`;

// Output from issue #25: Docker is started but the daemon is unresponsive.
// Docker 29 returns the same error with exit code 1. Older versions returned
// exit code 0, so the output must be checked first.
const unresponsiveInfo = `${clientInfo}

Server:
ERROR: Error response from daemon: Bad response from Docker engine
errors pretty printing info`;

// Real output from Docker 29.8.2 on macOS when the daemon socket is missing.
const stoppedInfo =
  'failed to connect to the docker API at unix:///var/run/docker.sock; ' +
  'check if the path is correct and if the daemon is running: ' +
  'dial unix /var/run/docker.sock: connect: no such file or directory';

// The older message, still used for TCP connections and by older versions.
const legacyStoppedInfo =
  'Cannot connect to the Docker daemon at tcp://127.0.0.1:1. ' +
  'Is the docker daemon running?';

// Real output from Docker 29.8.2 when the user cannot access the socket.
const permissionDeniedInfo =
  'permission denied while trying to connect to the docker API at ' +
  'unix:///var/run/docker.sock';

// A client plugin warning must not change the status of a healthy daemon.
const pluginWarningInfo =
  `${clientInfo}

WARNING: Plugin "bad" is not valid: failed to fetch metadata: ` +
  'fork/exec /usr/local/lib/docker/cli-plugins/docker-bad: ' +
  'no such file or directory';

// A daemon error can also mention a missing file.
const daemonMissingFileInfo =
  `ERROR: Error response from daemon: ` +
  'open /var/lib/docker/tmp: no such file or directory\n' +
  'errors pretty printing info';

// Real output from Docker 29.8.2 when the socket breaks during the request.
const transportErrorInfo =
  'error during connect: Get "http://%2Ftmp%2Fdocker.sock/v1.56/info": ' +
  'net/http: HTTP/1.x transport connection broken: malformed HTTP status code';

void describe('classifyDockerInfo', () => {
  void it('reports running when docker info succeeds', () => {
    assert.equal(classifyDockerInfo(0, clientInfo), 'running');
  });

  void it('reports unresponsive when the daemon returns an error', () => {
    assert.equal(classifyDockerInfo(1, unresponsiveInfo), 'unresponsive');
  });

  void it('reports unresponsive even when an older CLI exits 0', () => {
    assert.equal(classifyDockerInfo(0, unresponsiveInfo), 'unresponsive');
  });

  void it('reports stopped when the daemon socket cannot be reached', () => {
    assert.equal(classifyDockerInfo(1, stoppedInfo), 'stopped');
    assert.equal(classifyDockerInfo(1, legacyStoppedInfo), 'stopped');
  });

  void it('reports unresponsive when the socket is not accessible', () => {
    assert.equal(classifyDockerInfo(1, permissionDeniedInfo), 'unresponsive');
  });

  void it('ignores client warnings when the daemon is healthy', () => {
    assert.equal(classifyDockerInfo(0, pluginWarningInfo), 'running');
  });

  void it('reports unresponsive for a daemon error about a missing file', () => {
    assert.equal(classifyDockerInfo(1, daemonMissingFileInfo), 'unresponsive');
  });

  void it('reports stopped when the connection breaks before a response', () => {
    assert.equal(classifyDockerInfo(1, transportErrorInfo), 'stopped');
  });
});

void describe('docker status commands', () => {
  let fakeBinDir: string;
  let openLog: string;
  let originalPath: string | undefined;
  let tempRoot: string;

  // Quote a value for the generated shell scripts, so a TMPDIR with spaces or
  // quotes cannot break the fake docker/open commands.
  const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

  const writeScript = async (name: string, content: string) => {
    const file = path.join(fakeBinDir, name);
    await fs.writeFile(file, content);
    await fs.chmod(file, 0o755);
  };

  const stubDockerInfo = async (exitCode: number, output: string) => {
    await writeScript(
      'docker',
      `#!/bin/sh
cat >&2 <<'DOCKER_INFO'
${output}
DOCKER_INFO
exit ${exitCode}
`,
    );
  };

  const stubDockerInfoSequence = async (
    responses: { exitCode: number; output: string }[],
  ) => {
    const callsFile = path.join(fakeBinDir, 'docker-calls');
    await fs.rm(callsFile, { force: true });
    const cases = responses
      .map(
        ({ exitCode, output }, index) => `
${index + 1})
cat >&2 <<'DOCKER_INFO'
${output}
DOCKER_INFO
exit ${exitCode}
;;`,
      )
      .join('\n');
    const last = responses.at(-1)!;
    await writeScript(
      'docker',
      `#!/bin/sh
count=$(cat ${shellQuote(callsFile)} 2>/dev/null || echo 0)
count=$((count + 1))
echo "$count" > ${shellQuote(callsFile)}
case "$count" in
${cases}
*)
cat >&2 <<'DOCKER_INFO'
${last.output}
DOCKER_INFO
exit ${last.exitCode}
;;
esac
`,
    );
  };

  before(async () => {
    originalPath = process.env.PATH;
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'build-strap-docker-'));
    // Include a space in the path to catch unquoted shell variables.
    fakeBinDir = path.join(tempRoot, 'bin with space');
    await fs.mkdir(fakeBinDir);
    openLog = path.join(fakeBinDir, 'open.log');
    // The fake `open` records that a build tried to start a Docker app.
    await writeScript(
      'open',
      `#!/bin/sh\necho "$@" >> ${shellQuote(openLog)}\n`,
    );
    process.env.PATH = [fakeBinDir, originalPath]
      .filter(Boolean)
      .join(path.delimiter);
  });

  after(async () => {
    process.env.PATH = originalPath;
    await fs.rm(tempRoot, { force: true, recursive: true });
  });

  void it('reports docker as running only when docker info succeeds', async () => {
    await stubDockerInfo(0, clientInfo);
    assert.equal(await dockerIsRunning(), true);

    await stubDockerInfo(1, unresponsiveInfo);
    assert.equal(await dockerIsRunning(), false);
  });

  void it('fails fast without starting Docker when the daemon is unresponsive', async () => {
    await stubDockerInfo(1, unresponsiveInfo);

    await assert.rejects(ensureDockerRunning(1), /running but unresponsive/);

    // No start command can recover an unresponsive daemon, so `open` must not
    // run. Before the fix this test timed out after launching Docker.app.
    await assert.rejects(fs.access(openLog), { code: 'ENOENT' });
  });

  void it('keeps waiting when a starting daemon reports transient errors', async () => {
    await stubDockerInfoSequence([
      { exitCode: 1, output: unresponsiveInfo },
      { exitCode: 0, output: clientInfo },
    ]);

    // Docker Desktop can report a daemon error while it is still booting.
    // This must not abort the wait after the start command ran.
    await waitForDockerToStart(5, 'Docker');
  });

  void it('includes the real docker error in the fail-fast message', async () => {
    await stubDockerInfo(1, permissionDeniedInfo);

    await assert.rejects(
      ensureDockerRunning(1),
      /permission denied while trying to connect/,
    );
  });
});
