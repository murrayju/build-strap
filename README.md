# build-strap
A suite of functions to help with writing build scripts using TypeScript (or javascript) code (which run on node).

This project builds itself, so take a look in the `targets/` folder for an example. Run `./bs` to build.

[![CI Build](https://github.com/murrayju/build-strap/workflows/CI%20Build/badge.svg?branch=main)](https://github.com/murrayju/build-strap/actions?query=workflow%3A%22CI+Build%22)
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
    "nodeVersion": "24.18.0",
    "yarnVersion": "1.22.22",
    "repoType": "git",
    "copyright": "your company",
    "mainBranch": "main",
    "npm": {
      "publish": true,
    },
    "docker": {
      "registry": "ghcr.io",
      "repository": "your-company",
      "name": "your-project-name"
    }
  }
}
```

### mainBranch
The name of the single long-lived branch of the repository (defaults to `main`). All work happens on short-lived branches that are merged into it via pull request.

### docker
* **registry**: base URL for the docker registry, as needed by `docker push`.
* **repository**: the name of the (organization's) docker repository, in which to put this project
* **name**: the name of the project, used as the docker image name.

## Branching and Release Workflow
This project (and projects built with it) use a single long-lived branch (`main`) with short-lived work branches merged into it via pull request. There is no separate development or release branch.

Releases are triggered by pushing a [semver](https://semver.org/) tag (with an optional leading `v`) to a commit on `main`:

```
git tag v1.2.3 && git push origin v1.2.3
```

The version being built is determined as follows:

| Build | npm version | npm dist-tag | docker tags |
| --- | --- | --- | --- |
| Tag `v1.2.3` on `main` | `1.2.3` | `latest` | `latest`, `1`, `1.2`, `1.2.3` |
| Tag `v1.2.3-rc.1` on `main` | `1.2.3-rc.1` | `rc` | `1.2.3-rc.1`, `latest-rc` |
| Untagged commit on `main` | `1.2.3-main.42` | `next` | `latest-main` |
| Work branch / pull request | `1.2.3-my-branch.42` | `branch` | (none) |

For untagged builds, the base version comes from the `version` field in `package.json` and the build number comes from `--buildNum=` (or the `BUILD_NUMBER` environment variable). For release builds, the version comes from the git tag, and the build refuses to publish if the tagged commit is not contained in `main`.

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
