// @flow
import { CLIEngine } from 'eslint';
import { buildLog } from '../src/index';

// Lint the source using eslint
export default async function lint(
  autoFix: boolean = !process.argv.includes('--lint-no-fix'),
) {
  if (process.argv.includes('--no-lint')) {
    buildLog('Skipping due to --no-lint');
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
