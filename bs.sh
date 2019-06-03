#!/bin/bash
./yarn.sh install
exec ./yarn.sh run run "$@"
