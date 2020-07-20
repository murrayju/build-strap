// @flow
import path from 'path';
import { getCfg } from './pkg';

export type PathConfig = {
  [string]: string,
};

export function getPathCfg(): PathConfig {
  return getCfg().paths || {};
}

let _root = process.cwd();
export function setRoot(p: string) {
  _root = p;
}

const defaultPaths = {
  dist: './dist',
  out: './out',
  src: './src',
  download: './download',
};

export function getPaths() {
  return new Proxy(
    // $FlowFixMe
    {
      ...defaultPaths,
      ...getPathCfg(),
    },
    {
      get: (obj, prop) =>
        obj[prop]?.startsWith('/')
          ? obj[prop]
          : obj[prop]
          ? path.resolve(_root, obj[prop])
          : null,
    },
  );
}

export const distDir = () => getPaths().dist;
export const outDir = () => getPaths().out;
export const srcDir = () => getPaths().src;
export const getPath = (name: string) => getPaths()[name];
