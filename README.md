# build-strap
A suite of functions to help with writing build scripts using TypeScript (or javascript) code (which run on node).

This project builds itself, so take a look in the `targets/` folder for an example. Run `./bs` to build.

[![CI Build](https://github.com/murrayju/build-strap/workflows/CI%20Build/badge.svg?branch=main)](https://github.com/murrayju/build-strap/actions?query=workflow%3A%22CI+Build%22)
[![version](https://img.shields.io/github/v/tag/murrayju/build-strap.svg?label=version&sort=semver)](https://github.com/murrayju/build-strap/releases/latest)
[![npm](https://img.shields.io/npm/v/build-strap)](https://npmjs.org/package/build-strap)

## Create a "zero dependency" bootstrapped build
You can set up your project to build with (practically) no pre-requisite dependencies. [nub-strap](https://github.com/murrayju/nub-strap/) downloads a pinned version of [nub](https://nubjs.com) into the project. Nub then provides the pinned version of node, and is also the package manager.
- Copy the `nub` script from nub-strap into the root of your project, and pin the nub version in it.

```
curl -o nub https://raw.githubusercontent.com/murrayju/nub-strap/main/nub && chmod +x nub
```

- Pin the node version in your `package.json`, and set nub as the package manager (`./nub pm use nub` does this, and converts an existing lockfile to `nub.lock`).

```
{
  "devEngines": {
    "runtime": { "name": "node", "version": "26.13.0" },
    "packageManager": { "name": "nub", "version": "^0.10.0", "onFail": "ignore" }
  }
}
```

nub also installs in the mode of another package manager, and keeps that manager's lockfile. This project declares `pnpm` and keeps a `pnpm-lock.yaml`, so that a dependency bot can update `package.json` and the lockfile in the same pull request.

- Add a `bs` script, which installs dependencies and runs your build targets.

```
#!/bin/bash

./nub install
exec ./nub ./targets/run.ts "$@"
```

## Add the dependency reference
Add `build-strap` to your `package.json` (likely in the `devDependencies` section).
```
./nub add -D build-strap
```

## Add meta information to your `package.json`
By default, the build tools read project-specific configuration from your `package.json` file. Add this information as needed for your specific project.
```
{
  "name": "your-project-name",
  "version": "0.0.0",
  "buildStrap": {
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

Releases are triggered by pushing a [semver](https://semver.org/) tag (with an optional leading `v`) to a commit on `main`. The CI build of the tag publishes the release. To cut a release, run:

```
./bs release <major | minor | patch | prerelease | X.Y.Z> [--preid=<id>] [--dry-run]
```

This computes the next version from the highest release tag on `origin`, checks that you are on an up-to-date and clean `main`, asks for confirmation, then creates and pushes the tag `vX.Y.Z`. `prerelease` gives the next pre-release with the identifier `rc` (or `--preid=<id>`), for example `1.2.4-rc.0` after `1.2.3`. No commit is necessary. To give your project the same command, call the `release` function from a build target (see [targets/release.ts](targets/release.ts)).

The version being built is determined as follows:

| Build | npm version | npm dist-tag | docker tags |
| --- | --- | --- | --- |
| Tag `v1.2.3` on `main` | `1.2.3` | `latest` | `latest`, `1`, `1.2`, `1.2.3` |
| Tag `v1.2.3-rc.1` on `main` | `1.2.3-rc.1` | `rc` | `1.2.3-rc.1`, `latest-rc` |
| Untagged commit on `main` | `1.2.4-main.42` | `next` | `latest-main` |
| Work branch / pull request | `1.2.4-my-branch.42` | `branch` | (none) |

For release builds, the version comes from the git tag, and the build refuses to publish if the tagged commit is not contained in `main`. Untagged builds are pre-releases of a base version, and the build number comes from `--buildNum=` (or the `BUILD_NUMBER` environment variable). The base version depends on the `version` field in `package.json`:

- `0.0.0` (recommended, and used by this project): `package.json` does not keep the version. The base version is the next patch version after the highest release tag in the history of the commit. For example, after `v1.2.3`, untagged builds of `main` are `1.2.4-main.42`.
- Any other version: the base version is the version in `package.json`, and a release tag must have the same `major.minor.patch` as `package.json`.

On GitHub Actions, only the build for the tag push is a release build. The branch build of the same commit stays an untagged build, also when it already sees the tag. Elsewhere, a build is a release build when a semver tag points at the commit being built.

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

This example should serve as your entrypoint (for example, `./nub ./targets/run.ts`).
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
Write out to the console in a timestamp prefixed format consistent with the rest of the build output. Output goes to `stderr` by default, so that `stdout` can be reserved for machine readable output.
```
import { buildLog } from 'build-strap';

buildLog('Hello world');
```

Pass a `Date` (as before) or an options object to control the timestamp and destination:
```
buildLog('Hello world', new Date());
buildLog('to stdout instead', { stream: 'stdout' });
buildLog('to any writable stream', { stream: myWriteStream });
buildLog('or handle it yourself', { stream: (msg) => myLogger.info(msg) });
```

The default destination can be changed globally (affects `run`/`runCli` logging too):
```
import { getBuildLogStream, setBuildLogStream } from 'build-strap';

setBuildLogStream('stdout');
setBuildLogStream(process.stderr);
setBuildLogStream((msg) => myLogger.info(msg));
getBuildLogStream(); // current default
```

CLI flags:
- `--buildLog-stdout` — default to `stdout` instead of `stderr`
- `--silence-buildLog` — suppress all `buildLog` output

## NPM Credentials
In order to publish to NPM, proper credentials must be provided to the script. By default, these are read from the `NPM_CREDS` environment variable, but it is also possible to pass them as an argument to most functions. This is expected to be a JSON encoded string in the following format:
```
{ "email": "builder@your-company.com", "username":"builder", "password":"abc123" }
```
