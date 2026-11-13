import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { appendIfMissing } from '../src/fs.js';

void describe('appendIfMissing', () => {
  let tempDir: string;
  let dest: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'build-strap-fs-'));
    dest = path.join(tempDir, '.bashrc');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { force: true, recursive: true });
  });

  void it('ends a new file with a newline', async () => {
    await appendIfMissing(dest, '\nexport A=1');
    assert.equal(await fs.readFile(dest, 'utf8'), '\nexport A=1\n');
  });

  void it('ends the file with a newline after it appends', async () => {
    await fs.writeFile(dest, 'existing\n');
    await appendIfMissing(dest, '\nexport A=1');
    assert.equal(await fs.readFile(dest, 'utf8'), 'existing\n\nexport A=1\n');
  });

  void it('starts a new line when the file does not end with a newline', async () => {
    await fs.writeFile(dest, 'a=b');
    await appendIfMissing(dest, 'c=d');
    assert.equal(await fs.readFile(dest, 'utf8'), 'a=b\nc=d\n');
  });

  void it('does not add a second newline when the content starts with one', async () => {
    await fs.writeFile(dest, 'existing');
    await appendIfMissing(dest, '\nexport A=1');
    assert.equal(await fs.readFile(dest, 'utf8'), 'existing\nexport A=1\n');
  });

  void it('does not append the content again', async () => {
    await appendIfMissing(dest, '\nexport A=1');
    await appendIfMissing(dest, '\nexport A=1');
    assert.equal(await fs.readFile(dest, 'utf8'), '\nexport A=1\n');
  });

  void it('finds content that an earlier version appended with no newline at the end', async () => {
    await fs.writeFile(dest, 'existing\nexport A=1');
    await appendIfMissing(dest, '\nexport A=1');
    assert.equal(await fs.readFile(dest, 'utf8'), 'existing\nexport A=1');
  });

  void it('calls the content function one time', async () => {
    await fs.writeFile(dest, 'existing\n');
    let calls = 0;
    await appendIfMissing(dest, () => {
      calls += 1;
      return 'token=secret';
    });
    assert.equal(calls, 1);
    assert.equal(await fs.readFile(dest, 'utf8'), 'existing\ntoken=secret\n');
  });
});
