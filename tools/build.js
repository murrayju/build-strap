// @flow
import copy from './copy';
import babel from './babel';
import lint from './lint';
import flow from './flow';
import yarn from './yarn';
import { run, clean } from '../src/index';

/**
 * Compiles the project from source files into a distributable
 * format and copies it to the output (dist) folder.
 */
export default async function build() {
  await run(clean);
  await run(yarn);
  await run(lint);
  await run(flow);
  await run(copy);
  await run(babel);
}
