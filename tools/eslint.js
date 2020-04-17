// @flow
import { CLIEngine } from 'eslint';
import { buildLog } from '../src/index';

// Lint the source using eslint
export default async function eslint(
  autoFix: boolean = !process.argv.includes('--eslint-no-fix'),
) {
  if (process.argv.includes('--no-eslint')) {
    buildLog('Skipping due to --no-eslint');
    return null;
  }
  const engine = new CLIEngine({ fix: autoFix });
  const report = engine.executeOnFiles(['./src/', './tools/']);
  if (autoFix) {
    buildLog(`applying automatic eslint fixes`);
    CLIEngine.outputFixes(report);
  }
  if (report.errorCount || report.warningCount) {
    const formatter = engine.getFormatter();
    buildLog(`eslint results:\n${formatter(report.results)}`);
  }
  if (report.errorCount) {
    throw new Error('Linting failed');
  }
  return report;
}
