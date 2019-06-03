import { buildLog, spawn } from '../src/index';

// Normally handled by eslint, but we get more debug info when run separately
export default async function flow() {
  if (process.argv.includes('--no-flow')) {
    buildLog('Skipping due to --no-flow');
    return;
  }
  await spawn('flow', ['check'], { stdio: 'inherit', shell: true });
}
