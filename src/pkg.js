// @flow
import type { ArtifactoryConfig } from './artifactory';
import type { CertConfig } from './cert';
import type { DockerConfig } from './docker';
import type { NpmConfig } from './npm';

export type BuildStrapConfig = {
  repoType?: 'git' | 'hg',
  copyright?: string,
  releaseBranch?: string,
  devBranch?: string,
  artifactory?: ArtifactoryConfig,
  cert?: CertConfig,
  docker?: DockerConfig,
  npm?: NpmConfig,
};

type StringMap = {
  [string]: string,
};

export type PackageJson = {
  name: string,
  version: string,
  description?: string,
  private?: boolean,
  license?: string,
  authors?: string[],
  repository?: string,
  main?: string,
  dependencies?: StringMap,
  devDependencies?: StringMap,
  peerDependencies?: StringMap,
  engines?: StringMap,
  scripts?: StringMap,
  // our addition
  buildStrap: BuildStrapConfig,
};

let _pkg: ?PackageJson = null;
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

export function getPkgName(includeScope: boolean = false): string {
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

export function getPkgScope(): ?string {
  const pkgName = getPkgName(true);
  return pkgName.match(pkgNameRegex)?.[1] || null;
}
