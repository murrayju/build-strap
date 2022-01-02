import { CertConfig } from './cert.js';
import { DockerConfig } from './docker.js';
import { NpmConfig } from './npm.js';

export interface BuildStrapConfig {
  cert?: CertConfig;
  copyright?: string;
  devBranch?: string;
  docker?: DockerConfig;
  npm?: NpmConfig;
  releaseBranch?: string;
  repoType?: 'git' | 'hg';
}

export interface PackageJson {
  authors?: string[];
  // our addition
  buildStrap: BuildStrapConfig;
  dependencies?: Record<string, string>;
  description?: string;
  devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  license?: string;
  main?: string;
  name: string;
  peerDependencies?: Record<string, string>;
  private?: boolean;
  repository?: string | { type: string; url: string };
  scripts?: Record<string, string>;
  type?: string;
  types?: string;
  version: string;
}

// eslint-disable-next-line no-underscore-dangle
let _pkg: null | PackageJson = null;
export function getPkg(): PackageJson {
  if (_pkg == null) {
    throw new Error(
      'Must call setPkg() with package.json content before building.',
    );
  }
  return _pkg;
}

export function getCfg(): BuildStrapConfig {
  return getPkg().buildStrap || {};
}

export function setPkg(p: PackageJson) {
  _pkg = p;
}

const pkgNameRegex = /^(?:(@[^/]+)\/)?(.+)$/i;

export function getPkgName(includeScope = false): string {
  const pkg = getPkg();
  if (!(pkg.name && pkg.name.length)) {
    throw new Error(
      'Package name not found in package.json, but this is a required property!',
    );
  }
  if (includeScope) {
    return pkg.name;
  }
  const [, , shortName] = pkg.name.match(pkgNameRegex) || [];
  if (!shortName) {
    throw new Error('Package name in package.json has invalid format.');
  }
  return shortName;
}

export function getPkgScope(): null | string {
  const pkgName = getPkgName(true);
  return pkgName.match(pkgNameRegex)?.[1] || null;
}
