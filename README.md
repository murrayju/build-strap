# build-strap
A suite of functions to help with writing build scripts using javascript code (which run on node).

This project builds itself, so take a look in the `tools/` folder for an example project. Run `./bs` to build.

[![CI Build](https://github.com/murrayju/build-strap/workflows/CI%20Build/badge.svg?branch=master)](https://github.com/murrayju/build-strap/actions?query=workflow%3A%22CI+Build%22)
[![version](https://img.shields.io/github/v/tag/murrayju/build-strap.svg?label=version&sort=semver)](https://github.com/murrayju/build-strap/releases/latest)
[![npm](https://img.shields.io/npm/v/build-strap)](https://npmjs.org/package/build-strap)
[![dependencies](https://img.shields.io/david/murrayju/build-strap.svg)](https://david-dm.org/murrayju/build-strap)
[![devDependencies](https://img.shields.io/david/dev/murrayju/build-strap.svg)](https://david-dm.org/murrayju/build-strap?type=dev)

## Create a "zero dependency" bootstrapped build
You can set up your project to build with (practically) no pre-requisite dependencies.
- Copy the [build-strap-cli](https://github.com/murrayju/build-strap-cli/) into the root of your project.

```
curl -o bs https://raw.githubusercontent.com/murrayju/build-strap-cli/master/bs && chmod +x bs
curl -o bs.ps1 https://raw.githubusercontent.com/murrayju/build-strap-cli/master/bs.ps1
curl -o bs.bat https://raw.githubusercontent.com/murrayju/build-strap-cli/master/bs.bat
```

## Add the dependency reference
Add `build-strap` to your `package.json` (likely in the `devDependencies` section).
```
yarn add -D build-strap
```

## Add meta information to your `package.json`
By default, the build tools read project-specific configuration from your `package.json` file. Add this information as needed for your specific project.
```
{
  "name": "your-project-name",
  "version": "1.2.3",
  "buildStrap": {
    "nodeVersion": "12.18.2",
    "yarnVersion": "1.22.4",
    "repoType": "git",
    "copyright": "your company",
    "releaseBranch": "master",
    "devBranch": "dev",
    "npm": {
      "publish": true,
    },
    "artifactory": {
      "root": "https://artifactory.your-company.com/artifactory/",
      "path": "com/your-company/your-project-name",
      "version-folders": false,
      "integration": "integration-repo",
      "integration-branch-folders": true,
      "integration-days-to-keep": 14,
      "integration-max-to-keep": 10,
      "release": "releases-repo",
      "release-branch": "master",
      "npm": "npm-repo",
      "npm-clean": "internal-npm-repo"
    },
    "docker": {
      "registry": "artifactory.your-company.com",
      "repository": "your-company",
      "name": "your-project-name"
    }
  }
}
```
### artifactory
* **root**: base URL for the artifactory server
* **path**: path to project root in the artifactory tree.
* **version-folders**: if `true`, artifacts will be organized into subfolders for each version number
* **integration**: name of the artifactory repo in which to place integration (not official release) artifacts.
* **integration-branch-folders**: if `true`, artifacts will be organized into subfolders for each branch.
* **integration-days-to-keep**: for artifact cleanup, specifies the max age in days before an artifact will be deleted.
* **integration-max-to-keep**: for artifact cleanup, specifies the maximum number of artifacts to keep, regardless of age. Only the newest N artifacts will be kept.
* **release**: name of the artifactory repo in which to place release artifacts.
* **release-branch**: name of the mercurial branch from which official releases are built/published. Defaults to `master`.
* **npm**: name of the artifactory repo in which to publish npm artifacts.
* **npm-clean**: for artifact cleanup, the name of the artifactory repo used to find and delete old npm artifacts.

### docker
* **registry**: base URL for the docker registry, as needed by `docker push`.
* **repository**: the name of the (organization's) docker repository, in which to put this project
* **name**: the name of the project, used as the docker image name.

## Write Your Build Script
See the reference implementations (below) for a complete example of a robust build environment. The library exports many useful functions. Here are some of the most important (see source for more):

### setPkg
This function **must** be called for much of the functionality (that reads configuration from the `package.json`) to work. Pass it a javascript object containing the parsed content of `package.json` (or construct the object config directly in code).
```
import { setPkg } from 'build-strap';
import pkg from '../package.json';

// Call this before anything else.
setPkg(pkg);
...
```

### runCli
Useful when building your own build from scratch. Helps to interpret CLI arguments and invoke js files as build targets. Uses `buildLog` to timestamp everything.

This example should serve as your entrypoint (from `yarn run`).
```
import { run, runCli, setPkg } from 'build-strap';
import pkg from '../package.json';

setPkg(pkg);

if (require.main === module) {
  delete require.cache[__filename];
  runCli(path => require(`./${path}`).default);
}
```

### publish
Takes the contents of a directory, gzips it up, and publishes to various artifact repositories (as configured in your `package.json`, see above).
```
import { publish } from 'build-strap';

publish(
  'path/to/dist/folder',
  'path/to/output.tgz',
  reallyPublish, // `true` to actually publish, otherwise just make the bundle
);
```

### buildLog
Write out to the console in a timestamp prefixed format consistent with the rest of the build output.
```
import { buildLog } from 'build-strap';

buildLog('Hello world');
```

## NPM Credentials
In order to publish to NPM, proper credentials must be provided to the script. By default, these are read from the `NPM_CREDS` environment variable, but it is also possible to pass them as an argument to most functions. This is expected to be a JSON encoded string in the following format:
```
{ "email": "builder@your-company.com", "username":"builder", "password":"abc123" }
```

## Artifactory Credentials
In order to publish and/or delete things from Artifactory, proper credentials must be provided to the script. By default, these are read from the `ARTIFACTORY_CREDS` environment variable, but it is also possible to pass them as an argument to most functions. This is expected to be a JSON encoded string in the following format:
```
{ "email": "builder@your-company.com", "username":"builder", "password":"abc123" }
```
