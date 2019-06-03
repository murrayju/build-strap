#!/bin/bash
. ./nodeBootstrap.sh
exec $nodeCmd "$@"
