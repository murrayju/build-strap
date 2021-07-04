import { makeDir, spawn, buildLog } from '../src/index';

// Transpile js using babel
export default async function babel() {
  if (process.argv.includes('--no-babel')) {
    buildLog('Skipping due to --no-babel');
    return;
  }
  await makeDir('./dist');
  await spawn('babel', ['src', '-d', 'dist'], {
    stdio: 'inherit',
    shell: true,
  });
}
