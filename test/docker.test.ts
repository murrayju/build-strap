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
const unresponsiveInfo = `${clientInfo}

Server:
ERROR: Error response from daemon: Bad response from Docker engine
errors pretty printing info`;

// Output from `docker info` when Docker is not started.
const stoppedInfo = `${clientInfo}

Server:
ERROR: Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?
errors pretty printing info`;

void describe('classifyDockerInfo', () => {
  void it('reports running when docker info succeeds', () => {
    assert.equal(classifyDockerInfo(0, clientInfo), 'running');
  });

  void it('reports unresponsive when the daemon returns an error', () => {
    assert.equal(classifyDockerInfo(1, unresponsiveInfo), 'unresponsive');
  });

  void it('reports stopped when the daemon cannot be reached', () => {
    assert.equal(classifyDockerInfo(1, stoppedInfo), 'stopped');
  });
});

void describe('docker status commands', () => {
  let fakeBinDir: string;
  let openLog: string;
  let originalPath: string | undefined;

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
count=$(cat ${callsFile} 2>/dev/null || echo 0)
count=$((count + 1))
echo "$count" > ${callsFile}
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
    fakeBinDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'build-strap-docker-'),
    );
    openLog = path.join(fakeBinDir, 'open.log');
    // The fake `open` records that a build tried to start a Docker app.
    await writeScript('open', `#!/bin/sh\necho "$@" >> ${openLog}\n`);
    process.env.PATH = [fakeBinDir, originalPath]
      .filter(Boolean)
      .join(path.delimiter);
  });

  after(async () => {
    process.env.PATH = originalPath;
    await fs.rm(fakeBinDir, { force: true, recursive: true });
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
});
