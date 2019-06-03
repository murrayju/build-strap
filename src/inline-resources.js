// @flow
import glob from 'glob';
import path from 'path';
import fs from 'fs';
import { readFile, writeFile } from './fs';

// So we know to copy extra files when a dependency is modified
export const dependencies = {};

function recordDependency(parent, child) {
  dependencies[child] = dependencies[child] || [];
  if (!dependencies[child].includes(parent)) {
    dependencies[child].push(parent);
  }
}

/**
 * Inline resources in a tsc/ngc compilation.
 * @param projectPath {string} Path to the project.
 */
export async function inlineResources(projectPath: string) {
  // Match only TypeScript files in projectPath.
  const files = glob.sync('**/*.ts', { cwd: projectPath });

  // For each file, inline the templates and styles under it and write the new file.
  await Promise.all(
    files.map(async filePath => {
      const fullFilePath = path.join(projectPath, filePath);
      const content = await readFile(fullFilePath, 'utf-8');
      const inlined = inlineResourcesFromString(content, url => {
        // Resolve the template url.
        const templatePath = path.join(path.dirname(fullFilePath), url);
        recordDependency(fullFilePath, templatePath);
        return templatePath;
      });
      await writeFile(fullFilePath, inlined);
    }),
  );
}

export function requireResourcesLoader(content: string) {
  return [requireTemplate, requireStyle, removeModuleId].reduce(
    (c, fn) => fn(c, '!raw-loader!'),
    content,
  );
}

// This is a webpack loader
export function webpackInlineResourceLoader(content: string) {
  this.cacheable(true);
  const dir = this.context;
  const that = this;
  return inlineResourcesFromString(content, url => {
    // Resolve the template url.
    const fullPath = path.join(dir, url);
    // Make sure this file gets watched
    that.addDependency(fullPath);
    return fullPath;
  });
}

export type UrlResolver = (url: string) => string;

/**
 * Inline resources from a string content.
 * @param content {string} The source file's content.
 * @param urlResolver {Function} A resolver that takes a URL and return a path.
 * @returns {string} The content with resources inlined.
 */
export function inlineResourcesFromString(
  content: string,
  urlResolver: UrlResolver,
) {
  // Curry through the inlining functions.
  return [inlineTemplate, inlineStyle, removeModuleId].reduce(
    (c, fn) => fn(c, urlResolver),
    content,
  );
}

// The cbFn is given the template url, and should return the string to replace it
function processTemplate(content: string, cbFn: UrlResolver) {
  return content.replace(
    /templateUrl:\s*'([^']+?\.html)'/g,
    (m, templateUrl) => `template: ${cbFn(templateUrl)}`,
  );
}

/**
 * Inline the templates for a source file. Simply search for instances of `templateUrl: ...` and
 * replace with `template: ...` (with the content of the file included).
 * @param content {string} The source file's content.
 * @param urlResolver {Function} A resolver that takes a URL and return a path.
 * @return {string} The content with all templates inlined.
 */
function inlineTemplate(content: string, urlResolver: UrlResolver) {
  return processTemplate(
    content,
    templateUrl =>
      `\`${fs
        .readFileSync(urlResolver(templateUrl), 'utf-8')
        .replace(/([\n\r]\s*)+/gm, ' ')}\``,
  );
}

function requireTemplate(content: string, loader: string = '') {
  return processTemplate(content, url => `require('${loader}${url}')`);
}

// The cbFn is given the url of a single css file, and should return the string to replace it
function processStyle(content: string, cbFn: UrlResolver) {
  return content.replace(
    /styleUrls:\s*(\[[\s\S]*?\])/gm,
    (m, styleUrls) =>
      // eslint-disable-next-line no-eval
      `styles: [${eval(styleUrls)
        .map(styleUrl => cbFn(styleUrl))
        .join(',\n')}]`,
  );
}

/**
 * Inline the styles for a source file. Simply search for instances of `styleUrls: [...]` and
 * replace with `styles: [...]` (with the content of the file included).
 * @param urlResolver {Function} A resolver that takes a URL and return a path.
 * @param content {string} The source file's content.
 * @return {string} The content with all styles inlined.
 */
function inlineStyle(content: string, urlResolver: UrlResolver) {
  return processStyle(
    content,
    styleUrl =>
      `\`${fs
        .readFileSync(urlResolver(styleUrl), 'utf-8')
        .replace(/([\n\r]\s*)+/gm, ' ')}\``,
  );
}

function requireStyle(content: string, loader: string = '') {
  return processStyle(content, url => `require('${loader}${url}')`);
}

/**
 * Remove every mention of `moduleId: module.id`.
 * @param content {string} The source file's content.
 * @returns {string} The content with all moduleId: mentions removed.
 */
// eslint-disable-next-line no-unused-vars
function removeModuleId(content: string, urlResolver?: UrlResolver | string) {
  return content.replace(/\s*moduleId:\s*module\.id\s*,?\s*/gm, '');
}
