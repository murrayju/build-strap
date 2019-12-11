#!/usr/bin/env bash
./yarn.sh add $(./yarn.sh outdated | ghead -n -1 | gtail -n +7 | awk '{print $1}')
