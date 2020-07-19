// @flow
import { buildLog } from './run';

export type EslintOptions = {
  // Must pass the CLIEngine as imported from 'eslint'
  CLIEngine: any,
  paths?: string[],
  autoFix?: boolean,
};

// Lint the source using eslint
export const eslint = async ({
  CLIEngine,
  paths = ['./src/', './tools/'],
  autoFix = !process.argv.includes('--eslint-no-fix'),
}: EslintOptions) => {
  const engine = new CLIEngine({ fix: autoFix });
  const report = engine.executeOnFiles(paths);
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
};

export default eslint;
