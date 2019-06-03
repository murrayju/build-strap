#!/bin/bash
. ./nodeBootstrap.sh
exec $nodeCmd $yarnJs --scripts-prepend-node-path=true "$@"
