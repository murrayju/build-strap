#!/bin/bash
nodeVersion=12.13.1
yarnVersion=1.21.1
downloadDir=`pwd`/download
mkdir -p $downloadDir

if [ `getconf LONG_BIT` == "64" ]; then
	arch=x64
else
	arch=x86
fi
uname=`uname -s`
if [[ $uname =~ ^Darwin* ]]; then
	nodeName=node-v$nodeVersion-darwin-$arch
elif [[ $uname =~ ^Linux* ]]; then
	nodeName=node-v$nodeVersion-linux-$arch
else
	echo Unknown os: $uname
	exit
fi
nodeGz=$nodeName.tar.gz
nodeUrl=http://nodejs.org/dist/v$nodeVersion/$nodeGz
nodeDl=$downloadDir/$nodeGz

if [ ! -f $nodeDl ]; then
	echo Downloading $nodeUrl to $nodeDl
	curl -o $nodeDl $nodeUrl
fi

nodeDir=$downloadDir/$nodeName
export PATH=$nodeDir/bin:$PATH
nodeCmd=$nodeDir/bin/node
npmCmd=$nodeDir/bin/npm
if [ ! -f $npmCmd ]; then
	echo Extracting node gz
	tar xzf $nodeDl -C $downloadDir
fi
modulesDir=$nodeDir/node_modules
mkdir -p $modulesDir

yarnUrl=https://yarnpkg.com/downloads/$yarnVersion/yarn-v$yarnVersion.tar.gz
yarnDl=$downloadDir/yarn-v$yarnVersion.tar.gz
yarnDir=$modulesDir/yarn

if [ ! -f $yarnDl ]; then
	echo Downloading $yarnUrl to $yarnDl
	curl -L -o $yarnDl $yarnUrl
  if [ -f $yarnDir ]; then
    rm -r $yarnDir
  fi
fi

export PATH=$yarnDir/bin:$PATH
yarnJs=$yarnDir/bin/yarn.js
if [ ! -f $yarnJs ]; then
	echo Extracting yarn gz
	tar xzf $yarnDl -C $nodeDir/node_modules/
  mv $modulesDir/yarn-v$yarnVersion/ $yarnDir/
fi
