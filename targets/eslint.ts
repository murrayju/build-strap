import { ESLint } from 'eslint';

import { buildLog } from '../src/index.js';

export type ESLintOptions = {
  autoFix?: boolean;
  patterns?: string[] | string;
};

// Lint the source using eslint
export default async function eslint({
  autoFix = !process.argv.includes('--eslint-no-fix'),
  patterns = ['./'],
}: ESLintOptions = {}): Promise<ESLint.LintResult[]> {
  if (process.argv.includes('--no-eslint')) {
    buildLog('Skipping due to --no-eslint');
    return [];
  }
  const engine = new ESLint({ fix: autoFix });
  const results = await engine.lintFiles(patterns);
  if (autoFix) {
    buildLog(`applying automatic eslint fixes`);
    await ESLint.outputFixes(results);
  }
  const formatter = await engine.loadFormatter('stylish');
  const txtResults = formatter.format(results);
  buildLog(`eslint results: ${txtResults ? `\n${txtResults}` : 'success'}`);

  if (results.some((r) => r.errorCount)) {
    throw new Error('Linting failed');
  }
  return results;
}
